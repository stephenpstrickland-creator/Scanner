// ============================================================================
// Scanner app UI. Backends: RealBackend (Bluetooth adapter) and DemoBackend.
// ============================================================================
(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem('scanner.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('scanner.' + k, v); } catch (e) { /* private mode */ } },
};

// ---------------------------------------------------------------- live data definitions (metric)
const PIDS = [
  { k: 'rpm', pid: 0x0C, n: 'Engine speed', g: 'Engine', u: 'rpm', d: 0, min: 0, max: 4000, col: 'blue' },
  { k: 'speed', pid: 0x0D, n: 'Vehicle speed', g: 'Speed', conv: 'speed', d: 0, min: 0, max: 130, col: 'green' },
  { k: 'cool', pid: 0x05, n: 'Coolant temp', g: 'Coolant', conv: 'temp', d: 0, min: 40, max: 115, col: 'orange' },
  { k: 'load', pid: 0x04, n: 'Engine load', g: 'Load', u: '%', d: 0, min: 0, max: 100, col: 'indigo' },
  { k: 'tps', pid: 0x11, n: 'Throttle position', g: 'Throttle', u: '%', d: 0, min: 0, max: 100, col: 'teal' },
  { k: 'volt', pid: 0x42, n: 'Battery voltage', g: 'Battery', u: 'V', d: 1, min: 11, max: 15.5, col: 'yellow' },
  { k: 'iat', pid: 0x0F, n: 'Intake air temp', conv: 'temp', d: 0, min: 0, max: 70, col: 'teal' },
  { k: 'maf', pid: 0x10, n: 'Mass airflow', u: 'g/s', d: 1, min: 0, max: 60, col: 'blue' },
  { k: 'map', pid: 0x0B, n: 'Manifold pressure', u: 'kPa', d: 0, min: 0, max: 110, col: 'indigo' },
  { k: 'timing', pid: 0x0E, n: 'Timing advance', u: '°', d: 1, min: 0, max: 40, col: 'indigo' },
  { k: 'stft1', pid: 0x06, n: 'Short trim B1', u: '%', d: 1, min: -15, max: 15, col: 'blue', sign: true },
  { k: 'ltft1', pid: 0x07, n: 'Long trim B1', u: '%', d: 1, min: -15, max: 15, col: 'blue', sign: true },
  { k: 'stft2', pid: 0x08, n: 'Short trim B2', u: '%', d: 1, min: -15, max: 15, col: 'orange', sign: true },
  { k: 'ltft2', pid: 0x09, n: 'Long trim B2', u: '%', d: 1, min: -15, max: 15, col: 'orange', sign: true },
  { k: 'o2', pid: 0x14, n: 'O2 sensor B1S1', u: 'V', d: 2, min: 0, max: 1, col: 'green' },
  { k: 'fuel', pid: 0x2F, n: 'Fuel level', u: '%', d: 0, min: 0, max: 100, col: 'green' },
  { k: 'baro', pid: 0x33, n: 'Barometric pressure', u: 'kPa', d: 0, min: 60, max: 110, col: 'teal' },
  { k: 'amb', pid: 0x46, n: 'Outside air temp', conv: 'temp', d: 0, min: -20, max: 50, col: 'teal' },
  { k: 'oil', pid: 0x5C, n: 'Oil temp', conv: 'temp', d: 0, min: 40, max: 140, col: 'orange' },
  { k: 'runtime', pid: 0x1F, n: 'Run time', u: 's', d: 0, min: 0, max: 3600, col: 'indigo' },
];
const P = {}; PIDS.forEach((p) => { P[p.k] = p; });
const GAUGES = ['rpm', 'speed', 'cool', 'load', 'tps', 'volt'];
const GRAPHS = ['rpm', 'speed', 'cool', 'load', 'maf', 'stft1'];
const NH = 150;
const D = {}, H = {};
const pushH = (k, v) => { (H[k] = H[k] || []).push(v); if (H[k].length > NH) H[k].shift(); };

const CAUSES = {
  P0441: ['Purge valve (VSV) stuck or not opening', 'Cracked EVAP hose at the purge valve', 'Charcoal canister problem'],
  P0455: ['Loose, cracked or wrong gas cap', 'Disconnected or cracked EVAP hose', 'Canister or vent valve leaking'],
  P0442: ['Gas cap seal worn', 'Small crack in an EVAP hose', 'Leaking purge or vent valve'],
  P0456: ['Gas cap seal worn', 'Tiny EVAP hose or seal leak', 'Vent valve not sealing'],
  P0504: ['Worn brake light switch (most common)', 'Wiring or connector at the switch', 'Blown stop-light fuse'],
  P0171: ['Vacuum leak (hoses, intake gasket)', 'Dirty MAF sensor', 'Weak fuel pump or clogged filter'],
  P0174: ['Vacuum leak (hoses, intake gasket)', 'Dirty MAF sensor', 'Weak fuel pump or clogged filter'],
  P0420: ['Worn catalytic converter', 'Exhaust leak before the O2 sensor', 'Lazy downstream O2 sensor'],
  P0430: ['Worn catalytic converter', 'Exhaust leak before the O2 sensor', 'Lazy downstream O2 sensor'],
  P0128: ['Thermostat stuck open', 'Coolant temp sensor reading low', 'Low coolant'],
  P0300: ['Worn spark plugs or coils', 'Vacuum leak', 'Low fuel pressure'],
};
for (let c = 1; c <= 8; c++) CAUSES['P030' + c] = ['Spark plug or ignition coil on that cylinder', 'Injector on that cylinder', 'Low compression (valve, rings)'];

// ---------------------------------------------------------------- state
const S = {
  mode: 'off', status: '', theme: store.get('theme', 'dark'), tempU: store.get('tempU', 'F'), speedU: store.get('speedU', 'mph'),
  stack: ['home'], liveMode: 'gauges', graphKey: 'rpm', misMode: 'cur',
  codes: null, codesLoading: false, ff: null, ready: null, readyLoading: false, mis: null, misLoading: false,
  scan: { state: 'intro', results: [], i: 0, n: 0, name: '' }, makeKey: null, selMod: null,
  extra: [], busy: 0, inRead: false, rec: false, recRows: [], recStart: 0, lastRec: 0,
};
let B = null;

// ---------------------------------------------------------------- units
function conv(k, v) {
  const p = P[k];
  if (p && p.conv === 'temp' && S.tempU === 'F') return v * 9 / 5 + 32;
  if (p && p.conv === 'speed' && S.speedU === 'mph') return v / 1.609;
  return v;
}
function unit(k) {
  const p = P[k];
  if (p.conv === 'temp') return S.tempU === 'F' ? '°F' : '°C';
  if (p.conv === 'speed') return S.speedU === 'mph' ? 'mph' : 'km/h';
  return p.u;
}
function fmt(k, v) {
  if (v === undefined || v === null || isNaN(v)) return '—';
  const p = P[k], x = conv(k, v);
  let s = Math.abs(x) >= 1000 && p.d === 0 ? Math.round(x).toLocaleString('en-US') : x.toFixed(p.d);
  if (p.sign && x > 0) s = '+' + s;
  return s;
}
const tempStr = (c) => (c === null || c === undefined ? '—' : Math.round(S.tempU === 'F' ? c * 9 / 5 + 32 : c) + (S.tempU === 'F' ? '°F' : '°C'));
const colVar = (c) => 'var(--' + c + ')';
const pct = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';

// ---------------------------------------------------------------- real backend
class RealBackend {
  constructor() { this.t = NativeTransport.available() ? new NativeTransport() : new BleTransport(); this.e = new Elm(this.t); this.a = new AllSystems(this.e); this.adapterName = ''; }
  async connect(status) {
    this.t.onStatus = status;
    this.adapterName = await this.t.connect();
    this.t.onStatus = null;
    this.t.onDisconnect = () => onDisconnected();
    await this.e.connect(status);
  }
  get vin() { return this.e.vin; }
  get protoDesc() { return this.e.protoDesc; }
  get chip() { return this.e.stn || this.e.id; }
  get isCAN() { return this.e.isCAN(); }
  async _func() { if (this.e.enhActive) await this.e.enhEnd(); }
  supported(k) { return k === 'volt' || !!this.e.sup[P[k].pid]; }
  async readPid(k) {
    await this._func();
    if (k === 'volt' && !this.e.sup[0x42]) return this.e.readVoltage();
    return this.e.readPID(P[k].pid);
  }
  async codes() {
    await this._func();
    const rd = await this.e.readiness();
    const st = await this.e.readDTCs(3), pe = await this.e.readDTCs(7), pm = this.e.isCAN() ? await this.e.readDTCs(0x0A) : [];
    const ff = st && st.length ? await this.e.freezeFrame() : null;
    return { ok: st !== null, mil: rd ? rd.mil : false, stored: st || [], pending: pe || [], permanent: pm || [], ff };
  }
  async clearCodes() { await this._func(); return (await this.e.lines('04', 6000)).some((s) => s.startsWith('44')); }
  async readiness() { await this._func(); return this.e.readiness(); }
  async misfire() { await this._func(); return this.e.misfire(); }
  async scan(mods, step) {
    await this._func();
    this.e.enhBegin();
    const out = [];
    for (let i = 0; i < mods.length; i++) { step(i, mods[i], out); const r = await this.a.scanModule(mods[i]); if (r.present) out.push(r); }
    await this.e.enhEnd();
    return out;
  }
  async reread(r) { await this.a.readCodes(r.mod, r); await this.e.enhEnd(); }
  async clearModule(r) { const x = await this.a.clear(r.mod, r.svc); await this.e.enhEnd(); return x; }
  readExtra(p) { return this.a.readLive(p); }
  async check() { await this._func(); return this.a.adapterCheck(S.makeKey); }
  disconnect() { this.t.onDisconnect = null; this.t.disconnect(); }
}

// ---------------------------------------------------------------- demo backend
class DemoBackend {
  constructor() {
    this.vin = '5TETU62N37Z412345'; this.protoDesc = 'ISO 15765-4 (CAN 11/500)'; this.chip = 'Demo adapter'; this.adapterName = 'Demo'; this.isCAN = true;
    this.T = 45; this.codesList = ['P0441', 'P0455', 'P0504']; this.abs = [{ code: 'C0200', status: 8 }, { code: 'C1249', status: 8 }];
    this.misCur = [0, 0, 4, 0, 1, 0]; this.misAvg = [1, 0, 6, 0, 2, 1];
    for (let i = 0; i < NH; i++) { this.sim(); Object.keys(this.D).forEach((k) => pushH(k, this.D[k])); this.T += 0.2; }
    this.timer = setInterval(() => {
      this.sim(); this.T += 0.1; this.tick = (this.tick || 0) + 1;
      Object.assign(D, this.D);
      if (this.tick % 2 === 0) Object.keys(this.D).forEach((k) => pushH(k, this.D[k]));
      updateAll();
    }, 100);
  }
  async connect() { await sleep(600); }
  sim() {
    const t = this.T, ph = t % 40, rnd = (a) => (Math.random() * 2 - 1) * a, ease = (x) => x * x * (3 - 2 * x);
    let mph;
    if (ph < 8) mph = 0; else if (ph < 16) mph = 45 * ease((ph - 8) / 8); else if (ph < 30) mph = 45 + 2 * Math.sin(ph * 0.9);
    else if (ph < 36) mph = 45 * (1 - ease((ph - 30) / 6)); else mph = 0;
    const moving = mph > 0.5, accel = ph >= 8 && ph < 16, decel = ph >= 30 && ph < 36;
    let rpm;
    if (!moving) rpm = 700 + 14 * Math.sin(t * 2 * Math.PI * 1.6) + rnd(6);
    else { const g = mph < 12 ? 1 : mph < 24 ? 2 : mph < 36 ? 3 : 4; rpm = Math.max(820, mph * [0, 118, 66, 44, 33][g] + (accel ? 260 : 0)) + rnd(10); }
    const load = !moving ? 21 + rnd(1) : accel ? 62 + rnd(3) : decel ? 12 + rnd(1) : 52 + rnd(2);
    const f2c = (f) => (f - 32) * 5 / 9;
    this.D = {
      rpm, speed: mph * 1.609, load, tps: !moving ? 14.5 + rnd(.2) : accel ? 38 + rnd(2) : decel ? 13.7 : 18 + rnd(1),
      cool: f2c(150 + 46 * (1 - Math.exp(-t / 40)) + rnd(.3)), iat: f2c(88 + rnd(.4) - (moving ? 3 : 0)),
      maf: rpm * load / 100 * 0.0306 + rnd(.1), map: 30 + load * 0.6 + rnd(1), timing: !moving ? 10 + rnd(1) : accel ? 18 + rnd(1) : 32 + rnd(1),
      stft1: 1.4 * Math.sin(t * 1.3) + rnd(.8), stft2: 1.1 * Math.sin(t * 1.1 + 1) + rnd(.8), ltft1: 4.7, ltft2: 3.1,
      o2: (Math.sin(t * 5) > 0 ? 0.78 : 0.12) + rnd(.03), volt: 14.1 + rnd(.03), fuel: 62, baro: 101, runtime: t,
      atfA: f2c(140 + 35 * (1 - Math.exp(-t / 90)) + (moving ? 1.5 * Math.sin(t / 3) : 0) + rnd(.15)), atfB: f2c(130 + 30 * (1 - Math.exp(-t / 120)) + rnd(.1)),
    };
    if (!moving && Math.random() < 0.012) this.misCur[2]++;
  }
  supported(k) { return !['amb', 'oil'].includes(k); }
  async readPid(k) { await sleep(15); return this.D[k]; }
  async codes() {
    await sleep(700);
    return { ok: true, mil: this.codesList.length > 0, stored: this.codesList.slice(), pending: [], permanent: [],
      ff: this.codesList.length ? { code: 'P0441', rpm: 1840, speed: 61, cool: 90, load: 31, stft1: 2.3, ltft1: 4.7 } : null };
  }
  async clearCodes() { await sleep(800); this.codesList = []; return true; }
  async readiness() {
    await sleep(600);
    return { mil: this.codesList.length > 0, count: this.codesList.length, diesel: false, monitors: ['Misfire', 'Fuel system', 'Components', 'Catalyst', 'EVAP system', 'O2 sensor', 'O2 heater', 'EGR / VVT'].map((n) => ({ name: n, ready: n !== 'EVAP system' })) };
  }
  async misfire() { await sleep(700); return this.misCur.map((c, i) => ({ cyl: i + 1, cur: c, avg: this.misAvg[i] })); }
  async scan(mods, step) {
    const out = [];
    for (let i = 0; i < mods.length; i++) {
      step(i, mods[i], out);
      await sleep(170);
      const n = mods[i].name;
      if (/Engine \(ECM\)/.test(n)) out.push({ mod: mods[i], present: true, readOk: true, svc: 'obd', dtcs: this.codesList.map((c) => ({ code: c, status: 8 })), note: '' });
      if (/ABS/.test(n)) out.push({ mod: mods[i], present: true, readOk: true, svc: 'kwp', dtcs: this.abs.slice(), note: '' });
      if (/^Airbag \(SRS\)$/.test(n)) out.push({ mod: mods[i], present: true, readOk: true, svc: 'kwp', dtcs: [], note: '' });
      if (/Body control/.test(n)) out.push({ mod: mods[i], present: true, readOk: true, svc: 'kwp', dtcs: [], note: '' });
    }
    return out;
  }
  async reread(r) { await sleep(500); if (/ABS/.test(r.mod.name)) r.dtcs = this.abs.slice(); if (/Engine/.test(r.mod.name)) r.dtcs = this.codesList.map((c) => ({ code: c, status: 8 })); }
  async clearModule(r) {
    await sleep(700);
    if (/ABS/.test(r.mod.name)) this.abs = [];
    if (/Engine/.test(r.mod.name)) this.codesList = [];
    return { ok: true, msg: 'Codes cleared' };
  }
  async readExtra(p) { await sleep(40); if (p.req === '21D9') return p.bytes[0] === 4 ? this.D.atfA : this.D.atfB; return null; }
  async check() {
    await sleep(900);
    return [
      { name: 'Adapter responds', ok: true, detail: 'Demo' }, { name: 'Chip', ok: true, detail: 'Simulated' },
      { name: 'Vehicle connection', ok: true, detail: this.protoDesc }, { name: 'Custom headers (ATSH)', ok: true, detail: 'Supported' },
      { name: 'Extended addressing', ok: false, detail: 'Example of an unsupported feature' }, { name: 'ABS module test', ok: true, detail: 'Read 2 code(s)' },
    ];
  }
  disconnect() { clearInterval(this.timer); }
}

// ---------------------------------------------------------------- navigation
const TITLES = { mpg: 'Fuel', home: 'Home', live: 'Live', codes: 'Codes', ready: 'Readiness', systems: 'Systems', module: 'Module', misfire: 'Misfire', fuel: 'Fuel Trim', extra: 'Extra' };
const view = (n) => $('#v-' + n);
const top = () => S.stack[S.stack.length - 1];
function push(n) {
  const cur = top();
  if (cur === n) return;
  view(cur).classList.remove('active'); view(cur).classList.add('behind');
  const v = view(n); v.style.zIndex = S.stack.length + 1; v.classList.remove('behind');
  const bk = v.querySelector('.back span'); if (bk) bk.textContent = TITLES[cur] || 'Back';
  void v.offsetWidth; v.classList.add('active');
  S.stack.push(n); onShow(n);
}
function pop() {
  if (S.stack.length < 2) return;
  const cur = S.stack.pop(); view(cur).classList.remove('active');
  const prev = top(); view(prev).classList.remove('behind'); view(prev).classList.add('active');
  onShow(prev);
}
function goHome() { while (S.stack.length > 1) pop(); }
function onShow(n) {
  if (n === 'home') renderHome();
  if (n === 'codes') { renderCodes(); if (!S.codes && !S.codesLoading) loadCodes(); }
  if (n === 'ready') { renderReady(); if (!S.ready && !S.readyLoading) loadReady(); }
  if (n === 'systems') renderSystems();
  if (n === 'module') renderModule();
  if (n === 'misfire') { renderMis(); if (!S.mis && !S.misLoading) loadMis(); }
  if (n === 'live') { buildLive(); updateLive(); }
  if (n === 'extra') initExtra();
  if (n === 'fuel') drawFuel();
  if (n === 'mpg') renderMpg();
}

// ---------------------------------------------------------------- overlays
function alertBox(o) {
  $('#al-t').textContent = o.title; $('#al-m').textContent = o.msg || '';
  const ok = $('#al-ok'), no = $('#al-no'), acts = $('#al-acts');
  ok.textContent = o.ok || 'OK'; ok.className = o.dest ? 'dest' : 'bold';
  no.style.display = o.cancel === false ? 'none' : ''; acts.classList.toggle('one', o.cancel === false);
  no.textContent = o.cancel || 'Cancel';
  const sc = $('#alertscrim'); sc.classList.add('on');
  const close = () => sc.classList.remove('on');
  no.onclick = () => { close(); if (o.onCancel) o.onCancel(); };
  ok.onclick = () => { close(); if (o.onOk) o.onOk(); };   // synchronous: keeps the tap gesture for Bluetooth
}
function openSheet(title, html) { $('#sh-t').textContent = title; $('#sh-b').innerHTML = html; $('#sheetscrim').classList.add('on'); $('#sheet').classList.add('on'); }
function closeSheet() { $('#sheetscrim').classList.remove('on'); $('#sheet').classList.remove('on'); }
let hudT;
function hud(txt, icon) {
  $('#hudtxt').textContent = txt; $('#hudic').innerHTML = '<use href="#' + (icon || 'i-check') + '"/>';
  const h = $('#hud'); h.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(() => h.classList.remove('on'), 1500);
}

// ---------------------------------------------------------------- segmented controls
function segSet(seg, val) {
  const btns = $$('[data-seg="' + seg + '"] button'), ind = $('[data-seg="' + seg + '"] .ind');
  if (!ind) return;
  let idx = 0;
  btns.forEach((b, i) => { const on = b.dataset.val === val; b.classList.toggle('on', on); if (on) idx = i; });
  ind.style.width = 'calc((100% - 4px) / ' + btns.length + ')';
  ind.style.transform = 'translateX(' + idx * 100 + '%)';
}
function onSeg(seg, val) {
  segSet(seg, val);
  if (seg === 'live') { S.liveMode = val; ['gauges', 'list', 'graph'].forEach((m) => $('#p-' + m).classList.toggle('on', m === val)); updateLive(); }
  if (seg === 'mis') { S.misMode = val; renderMis(); }
  if (seg === 'mpg') { S.mpgMode = val; renderMpg(); }
  if (seg === 'body' && VEH) { VEH.body = val; VEH.bodyUser = val; saveVeh(VEH); const pv = $('.vprev'); if (pv) pv.innerHTML = heroArt(''); renderHome(); }
  if (seg === 'theme') { S.theme = val; store.set('theme', val); applyTheme(); }
  if (seg === 'temp') { S.tempU = val; store.set('tempU', val); liveBuilt = ''; buildLive(); refreshAll(); }
  if (seg === 'speedu') { S.speedU = val; store.set('speedU', val); liveBuilt = ''; buildLive(); refreshAll(); }
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  if (NativeTransport.available()) { try { window.webkit.messageHandlers.ble.postMessage({ op: 'theme', value: S.theme }); } catch (e) { /* ignore */ } }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = S.theme === 'dark' ? '#000000' : '#F2F2F7';
}

// ---------------------------------------------------------------- connection
function vehicleName() { return VEH ? vehTitle(VEH) : (B ? 'Vehicle' : 'No vehicle'); }
async function connect(demo) {
  if (S.mode !== 'off') return;
  const b = demo ? new DemoBackend() : new RealBackend();
  S.mode = 'connecting'; S.status = demo ? 'Starting demo...' : NativeTransport.available() ? 'Looking for adapters...' : 'Choose your adapter...'; renderHome();
  try {
    await b.connect((s) => { S.status = s; renderHome(); });
  } catch (err) {
    S.mode = 'off'; S.status = '';
    try { b.disconnect(); } catch (e) { /* ignore */ }
    renderHome();
    if (err && (err.name === 'NotFoundError' || /cancel/i.test(err.message))) return;
    alertBox({ title: 'Couldn’t connect', msg: (err && err.message) || String(err), cancel: false });
    return;
  }
  B = b; S.status = 'Identifying your vehicle...';
  S.makeKey = makeFromVIN(B.vin) || store.get('make', null);
  resetData();
  if (B.vin) {
    store.set('lastVin', B.vin);
    VEH = loadVeh(B.vin) || basicVeh(B.vin); saveVeh(VEH);
    loadFuel(B.vin);
    // Wait briefly for the exact model (cached after the first time) so the right vehicle drives in.
    const look = lookupVehicle(B.vin).then(ensurePhotos);
    const v = await Promise.race([look, sleep(2500).then(() => null)]);
    if (v) VEH = v;
    else look.then((x) => { if (x && B && x.vin === B.vin) { VEH = x; setTimeout(() => { if (top() === 'home') renderHome(); }, Math.max(0, S.arriveUntil - Date.now())); } });
  } else { VEH = null; loadFuel('none'); }
  S.mode = demo ? 'demo' : 'live';
  S.arrive = true; S.arriveUntil = Date.now() + 2600;
  renderHome();
  S.arrive = false;
  hud(demo ? 'Demo running' : 'Connected', demo ? 'i-gauge' : 'i-check');
  pollLoop();
  loadCodes();
}
function resetData() {
  S.codes = null; S.ff = null; S.ready = null; S.mis = null; S.scan = { state: 'intro', results: [], i: 0, n: 0, name: '' }; S.selMod = null; S.extra = [];
  Object.keys(D).forEach((k) => { delete D[k]; });
  if (S.mode === 'live') Object.keys(H).forEach((k) => { delete H[k]; });
}
function disconnect() {
  if (F.trip) saveFuel();
  if (B) B.disconnect();
  B = null; S.mode = 'off'; S.rec = false; resetData(); goHome(); renderHome(); closeSheet();
}
function onDisconnected() {
  if (S.mode !== 'live') return;
  B = null; S.mode = 'off'; resetData(); goHome(); renderHome();
  alertBox({ title: 'Adapter disconnected', msg: 'The Bluetooth connection dropped. Check the adapter is plugged in, then connect again.', cancel: false });
}
function needConnection() {
  alertBox({ title: 'Not connected', msg: 'Plug the adapter in, turn the key on, then connect. Or try the demo.', cancel: 'Try Demo', ok: 'Connect',
    onOk: () => connect(false), onCancel: () => connect(true) });
}

// Long operations pause live polling so they have the adapter to themselves.
async function job(fn) {
  S.busy++;
  try { while (S.inRead) await sleep(20); return await fn(); }
  finally { S.busy--; }
}

// ---------------------------------------------------------------- polling
let polling = false;
function fuelKeys() {
  if (!B) return [];
  if (B.supported('maf')) return ['maf', 'speed'];
  return ['map', 'rpm', 'iat', 'speed'].filter((k) => B.supported(k));
}
function pollKeys() {
  const k = basePollKeys();
  if (k === 'extra') return k;
  return k.concat(fuelKeys().filter((x) => !k.includes(x)));
}
function basePollKeys() {
  const t = top();
  if (t === 'live') {
    if (S.liveMode === 'gauges') return GAUGES;
    if (S.liveMode === 'graph') return [S.graphKey];
    return PIDS.map((p) => p.k);
  }
  if (t === 'fuel') return ['stft1', 'ltft1', 'stft2', 'ltft2'];
  if (t === 'home') return ['rpm', 'speed', 'cool', 'volt'];
  if (t === 'extra') return 'extra';
  return ['volt'];
}
async function pollLoop() {
  if (polling) return; polling = true;
  while (S.mode === 'live' || S.mode === 'demo') {
    if (S.busy) { await sleep(80); continue; }
    const keys = pollKeys();
    let did = 0;
    if (keys === 'extra') {
      for (let i = 0; i < S.extra.length; i++) {
        const x = S.extra[i];
        if (S.busy || top() !== 'extra' || !B || x.state === 2) continue;
        S.inRead = true;
        let v = null;
        try { v = await B.readExtra(x.p); } finally { S.inRead = false; }
        if (v !== null && v !== undefined) { x.v = v; x.state = 1; x.fails = 0; x.h.push(v); if (x.h.length > 80) x.h.shift(); }
        else if (++x.fails >= 2) x.state = 2;
        did++;
        if (top() === 'extra') drawExtra();
      }
    } else {
      for (const k of keys) {
        if (S.busy || !B || (S.mode !== 'live' && S.mode !== 'demo')) break;
        if (!B.supported(k)) continue;
        S.inRead = true;
        let v = null;
        try { v = await B.readPid(k); } catch (e) { v = null; } finally { S.inRead = false; }
        if (S.mode === 'live' && v !== null && v !== undefined) { D[k] = v; pushH(k, v); }
        did++;
      }
      if (S.mode === 'live') updateAll();
    }
    await sleep(did ? (S.mode === 'demo' ? 150 : 5) : 300);
  }
  polling = false;
}

// ---------------------------------------------------------------- vehicle identity & artwork
// (inserted into app.js; shares its scope: S, D, H, B, store, esc, $, $$, etc.)
const PAINTS = [['Silver', '#B8BCC2'], ['White', '#EDEDED'], ['Black', '#2A2B30'], ['Gray', '#6E7178'], ['Red', '#C21F32'],
  ['Blue', '#2457B5'], ['Green', '#2F6B45'], ['Tan', '#B69C74'], ['Orange', '#E8731C']];
const BODY_STYLES = [['truck', 'Pickup'], ['suv', 'SUV'], ['sedan', 'Car'], ['van', 'Van']];
let VEH = null;            // current vehicle {vin, make, model, year, body, disp, paint, ...}
let fetchSeq = 0;
const fetchWait = {};
window.__nativeFetch = (id, text) => { const w = fetchWait[id]; if (w) { delete fetchWait[id]; w(text); } };

// JSON GET. Inside the iPhone app the request goes through Swift (no browser CORS limits).
function getJSON(url, ms) {
  ms = ms || 8000;
  if (NativeTransport.available()) {
    return new Promise((res, rej) => {
      const id = 'f' + (++fetchSeq);
      const t = setTimeout(() => { delete fetchWait[id]; rej(new Error('timeout')); }, ms);
      fetchWait[id] = (text) => { clearTimeout(t); try { res(JSON.parse(text)); } catch (e) { rej(e); } };
      window.webkit.messageHandlers.ble.postMessage({ op: 'fetch', id, url });
    });
  }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => { if (ctl) ctl.abort(); }, ms);
  return fetch(url, ctl ? { signal: ctl.signal } : {}).then((r) => r.json()).finally(() => clearTimeout(t));
}

const vehKey = (vin) => 'veh.' + (vin || 'none');
function loadVeh(vin) { try { return JSON.parse(store.get(vehKey(vin), 'null')); } catch (e) { return null; } }
function saveVeh(v) { if (v) store.set(vehKey(v.vin), JSON.stringify(v)); }
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Bmw|Gmc|Ram|Mg|Byd)\b/g, (m) => m.toUpperCase());
function bodyFromClass(c) {
  c = (c || '').toLowerCase();
  if (/pickup/.test(c)) return 'truck';
  if (/sport utility|suv|multi-purpose|crossover/.test(c)) return 'suv';
  if (/van/.test(c)) return 'van';
  return 'sedan';
}
function basicVeh(vin) {
  const mk = makeFromVIN(vin);
  return { vin, make: mk ? VEHICLE_DB[mk].name.split(' /')[0] : '', model: '', year: modelYear(vin) || '', body: 'sedan', disp: null, paint: '#B8BCC2', src: 'vin' };
}
// Exact year/make/model/body from the free NHTSA VIN decoder; cached per VIN.
async function lookupVehicle(vin) {
  if (!vin) return null;
  let v = loadVeh(vin) || basicVeh(vin);
  if (v.src !== 'nhtsa') {
    try {
      const j = await getJSON('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
      const x = j && j.Results && j.Results[0];
      if (x && x.Make) {
        Object.assign(v, {
          make: titleCase(x.Make), model: x.Model || v.model, year: +x.ModelYear || v.year, bodyClass: x.BodyClass || '',
          body: v.bodyUser || bodyFromClass(x.BodyClass), disp: parseFloat(x.DisplacementL) || v.disp, cyl: +x.EngineCylinders || null,
          fuelType: x.FuelTypePrimary || '', drive: x.DriveType || '', trim: x.Trim || '', src: 'nhtsa',
        });
      }
    } catch (e) { /* offline - keep the VIN-based basics */ }
  }
  saveVeh(v);
  return v;
}

// Real photos of the exact model: NHTSA studio shots (public domain, mostly 2011+),
// then freely licensed photos from Wikimedia Commons (credited on screen).
function scorePhoto(title, ii, v) {
  const t = title.toLowerCase().replace(/^file:/, ''), model = String(v.model || '').toLowerCase().split(/\s+/)[0];
  if (!ii || !ii.thumburl || !model || !t.includes(model)) return 0;
  if (/\.(svg|gif|pdf|tiff?|webm|ogv|png)$/.test(t)) return 0;
  if (/\b(interior|engine|dashboard|badge|logo|emblem|wheels?|rims?|seats?|cockpit|tail ?lights?|headlights?|lamps?|grilles?|steering|trunk|cargo|toys?|model car|diecast|die-cast|lego|crash(ed)?|wreck(ed)?|damaged?|accident|burn(ed|t)?|rust(y)?|police|ambulance|fire|taxi|racing|race|rally|drift|parts|brochure)\b/.test(t)) return 0;
  let s = 1;
  const y = +v.year;
  if (y && t.includes(String(y))) s += 5;
  const r = t.match(/((?:19|20)\d{2})\s*[–-]\s*((?:19|20)?\d{2})/);
  if (r && y) { const a = +r[1], b = +(r[2].length === 2 ? r[1].slice(0, 2) + r[2] : r[2]); if (y >= a && y <= b) s += 4; }
  const years = (t.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  if (y && years.length && !r && years.every((x) => Math.abs(x - y) > 3)) s -= 4;
  if (/front|3\/4|three.quarter/.test(t)) s += 2;
  if (/\brear\b|\bback\b/.test(t)) s -= 1;
  if (ii.width && ii.height) s += ii.width > ii.height * 1.2 ? 2 : -3;
  if (/nhtsa/.test(t)) s += 1;
  return s;
}
const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
async function findStockPhotos(v) {
  const out = [];
  if (!v || !v.make || !v.model || !v.year) return out;
  try {
    const list = await getJSON('https://api.nhtsa.gov/SafetyRatings/modelyear/' + v.year + '/make/' + encodeURIComponent(v.make) + '/model/' + encodeURIComponent(v.model));
    const rows = (list && (list.Results || list)) || [];
    const ids = (Array.isArray(rows) ? rows : []).slice(0, 4).map((r) => r.VehicleId).filter(Boolean);
    for (const id of ids) {
      const d = await getJSON('https://api.nhtsa.gov/SafetyRatings/VehicleId/' + id);
      const r = d && d.Results && d.Results[0];
      if (r && r.VehiclePicture && !out.some((o) => o.url === r.VehiclePicture)) out.push({ url: r.VehiclePicture, credit: 'Photo: NHTSA (public domain)', title: r.VehicleDescription || '' });
    }
  } catch (e) { /* none */ }
  try {
    const q = v.year + ' ' + v.make + ' ' + v.model;
    const j = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=' +
      encodeURIComponent(q) + '&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1000');
    const pages = Object.values((j && j.query && j.query.pages) || {});
    pages.map((p) => ({ p, ii: p.imageinfo && p.imageinfo[0] })).map((x) => Object.assign(x, { s: scorePhoto(x.p.title, x.ii, v) }))
      .filter((x) => x.s > 1).sort((a, b) => b.s - a.s).slice(0, 8).forEach((x) => {
        const m = x.ii.extmetadata || {}, artist = stripTags(m.Artist && m.Artist.value).slice(0, 48), lic = stripTags(m.LicenseShortName && m.LicenseShortName.value);
        out.push({ url: x.ii.thumburl, credit: 'Photo: ' + (artist || 'Wikimedia Commons') + (lic ? ' · ' + lic : '') + ' · Wikimedia Commons', title: x.p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '') });
      });
  } catch (e) { /* offline */ }
  return out;
}
async function ensurePhotos(v) {
  if (!v || v.photos || v.src !== 'nhtsa') return v;
  const ph = await findStockPhotos(v);
  v.photos = ph; v.photoIdx = ph.length ? 0 : -1; saveVeh(v);
  return v;
}
window.__heroImgFail = (img) => {
  if (VEH && VEH.photos && VEH.photoIdx >= 0) { VEH.photos.splice(VEH.photoIdx, 1); VEH.photoIdx = VEH.photos.length ? 0 : -1; saveVeh(VEH); }
  const wrap = img.closest('.stage, .vprev');
  if (wrap) { wrap.classList.remove('photo'); wrap.innerHTML = carSVG(VEH ? VEH.body : 'sedan', VEH ? VEH.paint : '#8E8E93', 'on'); }
};
function vehTitle(v) {
  if (!v) return 'Vehicle';
  const saved = store.get('vname.' + v.vin, '');
  if (saved) return saved;
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}
function vehSub(v) {
  if (!v) return '';
  return [v.disp ? v.disp.toFixed(1) + 'L' + (v.cyl ? ' V' + v.cyl : '') : '', v.drive, v.bodyClass].filter(Boolean).join(' · ');
}
const photoKey = (vin) => 'photo.' + (vin || 'none');

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  return '#' + c.map((x) => Math.round((t - x) * p + x).toString(16).padStart(2, '0')).join('');
}

// Original side-view illustrations by body style (not any brand's design).
const CAR_SHAPES = {
  truck: { body: 'M18,128 L18,80 Q18,76 22,76 L188,76 L196,40 Q198,32 208,32 L268,32 Q280,32 288,42 L308,72 L370,78 Q388,80 391,96 L392,120 Q392,128 384,128 Z',
    glass: ['M204,40 L264,40 Q272,40 277,47 L294,70 L200,70 Z'], pillars: [[238, 38, 7, 34]], seams: [[188, 78, 188, 124], [196, 74, 196, 124], [298, 74, 298, 124]],
    wheels: [92, 316], wy: 128, head: [380, 90], headPath: 'M376,84 L391,86 L391,95 L374,92 Z', tail: [18, 82, 6, 16], handles: [[264, 82]], line: 96 },
  suv: { body: 'M20,128 L20,40 Q20,22 40,22 L268,22 Q281,22 290,31 L322,64 L372,71 Q390,75 392,92 L392,120 Q392,128 384,128 Z',
    glass: ['M34,32 L100,32 L100,60 L34,60 Z', 'M108,32 L266,32 Q276,32 283,39 L304,60 L108,60 Z'], pillars: [[196, 30, 7, 32], [250, 30, 7, 32]],
    seams: [[200, 64, 200, 122], [306, 66, 306, 122], [104, 62, 104, 122]], wheels: [96, 306], wy: 128, head: [384, 87], headPath: 'M378,81 L392,85 L392,94 L376,91 Z',
    tail: [20, 50, 6, 20], handles: [[170, 72], [270, 72]], line: 88 },
  sedan: { body: 'M16,126 L18,96 Q20,84 40,82 L108,74 L148,46 Q156,40 170,40 L252,40 Q266,40 276,50 L306,74 L366,80 Q388,84 390,100 L390,120 Q390,126 382,126 Z',
    glass: ['M158,48 L250,48 Q260,48 268,56 L290,74 L124,76 L150,54 Q154,48 158,48 Z'], pillars: [[208, 46, 7, 32]],
    seams: [[212, 78, 212, 120], [296, 78, 296, 120], [128, 80, 128, 120]], wheels: [96, 306], wy: 126, head: [382, 93], headPath: 'M374,88 L390,90 L390,98 L372,96 Z',
    tail: [16, 92, 6, 12], handles: [[176, 86], [256, 86]], line: 100 },
  van: { body: 'M18,128 L18,40 Q18,24 34,24 L250,24 Q266,24 278,36 L330,76 L374,82 Q390,86 392,100 L392,120 Q392,128 384,128 Z',
    glass: ['M30,34 L120,34 L120,64 L30,64 Z', 'M128,34 L210,34 L210,64 L128,64 Z', 'M218,34 L256,34 Q264,34 270,40 L300,64 L218,64 Z'], pillars: [],
    seams: [[214, 68, 214, 124], [310, 72, 310, 124]], wheels: [92, 312], wy: 128, head: [384, 96], headPath: 'M376,90 L392,92 L392,101 L374,98 Z',
    tail: [18, 70, 6, 20], handles: [[234, 82]], line: 104 },
};
function carSVG(body, paint, cls) {
  const s = CAR_SHAPES[body] || CAR_SHAPES.sedan, id = 'c' + Math.random().toString(36).slice(2, 8), wy = s.wy;
  paint = paint || '#B8BCC2';
  const hi = shade(paint, 0.3), lo = shade(paint, -0.35), well = shade(paint, -0.72);
  let g = '<svg class="carsvg ' + (cls || '') + '" viewBox="0 0 400 170" role="img" aria-label="Vehicle illustration"><defs>' +
    '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + hi + '"/><stop offset=".5" stop-color="' + paint + '"/><stop offset="1" stop-color="' + lo + '"/></linearGradient>' +
    '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6878"/><stop offset="1" stop-color="#11161c"/></linearGradient>' +
    '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dbde"/><stop offset="1" stop-color="#7b7f86"/></linearGradient>' +
    '<radialGradient id="' + id + 's"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="' + id + 'h"><stop offset="0" stop-color="#FFF7D6" stop-opacity="1"/><stop offset="1" stop-color="#FFF7D6" stop-opacity="0"/></radialGradient>' +
    '<clipPath id="' + id + 'c"><path d="' + s.body + '"/></clipPath></defs>' +
    '<ellipse cx="205" cy="' + (wy + 28) + '" rx="195" ry="13" fill="url(#' + id + 's)"/>' +
    '<path d="' + s.body + '" fill="url(#' + id + 'b)"/>';
  s.glass.forEach((p) => { g += '<path d="' + p + '" fill="url(#' + id + 'g)"/>'; });
  s.pillars.forEach((p) => { g += '<rect x="' + p[0] + '" y="' + p[1] + '" width="' + p[2] + '" height="' + p[3] + '" fill="' + paint + '"/>'; });
  g += '<line x1="30" x2="378" y1="' + s.line + '" y2="' + s.line + '" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>';
  s.seams.forEach((p) => { g += '<line x1="' + p[0] + '" y1="' + p[1] + '" x2="' + p[2] + '" y2="' + p[3] + '" stroke="#000" stroke-opacity=".22" stroke-width="1.5"/>'; });
  s.handles.forEach((p) => { g += '<rect x="' + p[0] + '" y="' + p[1] + '" width="14" height="4" rx="2" fill="#000" fill-opacity=".3"/>'; });
  g += '<path d="' + s.headPath + '" fill="#FFF3C4"/><rect x="' + s.tail[0] + '" y="' + s.tail[1] + '" width="' + s.tail[2] + '" height="' + s.tail[3] + '" rx="2" fill="#E0302A"/>';
  g += '<g clip-path="url(#' + id + 'c)">' + s.wheels.map((x) => '<circle cx="' + x + '" cy="' + wy + '" r="35" fill="' + well + '"/>').join('') + '</g>';
  s.wheels.forEach((x) => {
    g += '<circle cx="' + x + '" cy="' + wy + '" r="30" fill="#17171a"/>' +
      '<circle cx="' + x + '" cy="' + wy + '" r="19" fill="url(#' + id + 'r)"/><circle cx="' + x + '" cy="' + wy + '" r="19" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="2"/>';
    for (let k = 0; k < 5; k++) { const a = (k * 72 - 90) * Math.PI / 180; g += '<line x1="' + x + '" y1="' + wy + '" x2="' + (x + 16 * Math.cos(a)).toFixed(1) + '" y2="' + (wy + 16 * Math.sin(a)).toFixed(1) + '" stroke="#5d6168" stroke-width="3" stroke-linecap="round"/>'; }
    g += '<circle cx="' + x + '" cy="' + wy + '" r="5.5" fill="#3a3a3c"/>';
  });
  g += '<ellipse class="glow" cx="' + s.head[0] + '" cy="' + s.head[1] + '" rx="34" ry="20" fill="url(#' + id + 'h)" opacity="0"/></svg>';
  return g;
}

function heroPhoto() {
  const vin = VEH ? VEH.vin : store.get('lastVin', '');
  const own = vin ? store.get(photoKey(vin), '') : '';
  if (own && !(VEH && VEH.useOwn === false)) return { url: own, credit: '' };
  if (VEH && VEH.photos && VEH.photoIdx >= 0 && VEH.photos[VEH.photoIdx]) return VEH.photos[VEH.photoIdx];
  return null;
}
function heroArt(cls) {
  const ph = heroPhoto();
  if (ph) return '<img class="carphoto ' + (cls || '') + '" src="' + esc(ph.url) + '" alt="' + esc(VEH ? vehTitle(VEH) : 'Your vehicle') + '" onerror="__heroImgFail(this)">' +
    (ph.credit ? '<span class="credit">' + esc(ph.credit) + '</span>' : '');
  return carSVG(VEH ? VEH.body : 'sedan', VEH ? VEH.paint : '#8E8E93', cls);
}

function vehicleSheet() {
  if (!VEH) { hud('Connect first', 'i-info'); return; }
  const v = VEH, own = store.get(photoKey(v.vin), ''), photos = v.photos || [];
  const sel = own && v.useOwn !== false ? 'own' : v.photoIdx >= 0 && photos[v.photoIdx] ? v.photoIdx : 'art';
  const tile = (key, inner, label) => '<button class="ptile tap' + (String(sel) === String(key) ? ' on' : '') + '" data-act="choosePic" data-k="' + key + '" aria-label="' + esc(label) + '">' + inner + '</button>';
  let tiles = '';
  if (own) tiles += tile('own', '<img src="' + own + '" alt="">', 'Your photo');
  photos.forEach((p, i) => { tiles += tile(i, '<img src="' + esc(p.url) + '" alt="" loading="lazy">', p.title || 'Photo ' + (i + 1)); });
  tiles += tile('art', carSVG(v.body, v.paint, ''), 'Illustration');
  const sw = PAINTS.map((p) => '<button class="swatch tap' + (p[1] === v.paint ? ' on' : '') + '" data-act="setPaint" data-c="' + p[1] + '" aria-label="' + p[0] + '" style="background:' + p[1] + '"></button>').join('');
  const searching = v.photos === undefined && v.src === 'nhtsa';
  openSheet('Your Vehicle',
    '<div class="vprev' + (sel === 'art' ? '' : ' photo') + '">' + heroArt('') + '</div>' +
    '<div class="cap">Picture</div><div class="ptiles">' + tiles + '</div>' +
    (searching ? '<p class="foot" style="text-align:left;margin:0 4px">Looking for photos of your model...</p>'
      : (!photos.length ? '<p class="foot" style="text-align:left;margin:0 4px">No photos of this model found online right now. Use your own photo below.</p>' : '')) +
    '<div class="group"><button class="row tap" data-act="pickPhoto"><span class="grow" style="color:var(--blueT)">' + (own ? 'Replace My Photo' : 'Use My Own Photo') + '</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button>' +
    (own ? '<button class="row tap" data-act="removePhoto"><span class="grow" style="color:var(--redT)">Remove My Photo</span></button>' : '') + '</div>' +
    '<p class="foot" style="text-align:left;margin:0 4px">Tip: in the Photos app, touch and hold your truck in a picture, tap <b>Share</b> to lift it off the background, save it, then choose it here for a clean cut-out look.</p>' +
    (sel === 'art' ? '<div class="cap">Illustration color</div><div class="swatches">' + sw + '</div>' +
      '<div class="cap">Body style</div><div class="seg" data-seg="body"><span class="ind"></span>' + BODY_STYLES.map((b) => '<button data-val="' + b[0] + '">' + b[1] + '</button>').join('') + '</div>' : '') +
    '<div class="cap">Details</div><div class="group">' +
    '<div class="row"><span class="grow">Name</span><input type="text" id="vname" value="' + esc(vehTitle(v)) + '" aria-label="Vehicle name"></div>' +
    '<div class="row"><span class="grow">Engine size (L)</span><input type="number" inputmode="decimal" step="0.1" id="vdisp" value="' + (v.disp || '') + '" placeholder="e.g. 4.0" aria-label="Engine size in liters"></div>' +
    '<div class="row"><span class="grow">VIN</span><span class="val num">' + esc(v.vin) + '</span></div></div>' +
    '<p class="foot">Year, make and model come from the NHTSA VIN decoder. Photos come from NHTSA (public domain) or Wikimedia Commons (free licenses, credited on the picture) and may not match your exact trim or color.</p>');
  if (sel === 'art') segSet('body', v.body);
  const vn = $('#vname'), vd = $('#vdisp');
  vn.addEventListener('change', () => { store.set('vname.' + v.vin, vn.value.trim()); renderHome(); });
  vd.addEventListener('change', () => { const x = parseFloat(vd.value); v.disp = x > 0 && x < 10 ? x : v.disp; saveVeh(v); });
  if (searching) ensurePhotos(v).then(() => { if ($('#sh-t').textContent === 'Your Vehicle') vehicleSheet(); renderHome(); });
}
function pickPhoto() {
  let inp = $('#photoin');
  if (!inp) {
    inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'photoin'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; if (!f || !VEH) return;
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        const max = 1100, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let data = c.toDataURL('image/jpeg', 0.82);
        if (data.length > 1500000) data = c.toDataURL('image/jpeg', 0.6);
        store.set(photoKey(VEH.vin), data); VEH.useOwn = true; saveVeh(VEH);
        URL.revokeObjectURL(url); inp.value = '';
        vehicleSheet(); renderHome(); hud('Photo saved');
      };
      img.onerror = () => { hud('Couldn’t read that photo', 'i-info'); };
      img.src = url;
    });
  }
  inp.click();
}

// ---------------------------------------------------------------- fuel & MPG tracker
const GAL_PER_GRAM_HR = 3600 / (14.7 * 2798.7);   // MAF (g/s) -> gal/h at 14.7:1, 6.17 lb/gal gasoline
const F = { vin: null, price: 3.25, fills: [], trips: [], trip: null, lastT: 0, inst: null, gph: null, lastSave: 0 };
const fk = (n) => 'fuel.' + n + '.' + (F.vin || 'none');
const newTrip = () => ({ start: Date.now(), last: Date.now(), miles: 0, gal: 0, secs: 0, idle: 0 });
function loadFuel(vin) {
  F.vin = vin || 'none';
  const j = (k, d) => { try { return JSON.parse(store.get(fk(k), 'null')) || d; } catch (e) { return d; } };
  F.fills = j('fills', []); F.trips = j('trips', []); F.trip = j('trip', null);
  F.price = parseFloat(store.get('fuel.price', '')) || (F.fills.length ? F.fills[F.fills.length - 1].ppg : 3.25);
  if (!F.trip || Date.now() - F.trip.last > 2 * 3600 * 1000) archiveTrip(true);
  F.lastT = 0;
}
function saveFuel() {
  store.set(fk('fills'), JSON.stringify(F.fills)); store.set(fk('trips'), JSON.stringify(F.trips.slice(-100)));
  store.set(fk('trip'), JSON.stringify(F.trip)); F.lastSave = Date.now();
}
function archiveTrip(quiet) {
  if (F.trip && F.trip.miles >= 0.2) F.trips.push(Object.assign({}, F.trip, { ppg: F.price }));
  F.trip = newTrip(); F.lastT = 0;
  saveFuel();
  if (!quiet) hud('New trip started', 'i-pump');
}
function fuelRate() {
  if (D.maf !== undefined && D.maf !== null && !isNaN(D.maf)) return D.maf * GAL_PER_GRAM_HR;
  if (D.map !== undefined && D.rpm !== undefined && D.iat !== undefined) {
    const disp = (VEH && VEH.disp) || 2.5;
    const maf = (D.map * 1000) / (287.05 * (D.iat + 273.15)) * (disp / 1000) * (D.rpm / 120) * 0.85 * 1000;   // speed-density
    return maf * GAL_PER_GRAM_HR;
  }
  return null;
}
function fuelTick() {
  if (!F.trip || !(S.mode === 'live' || S.mode === 'demo')) return;
  const now = performance.now();
  if (!F.lastT) { F.lastT = now; return; }
  let dt = (now - F.lastT) / 1000; F.lastT = now;
  if (dt <= 0) return; if (dt > 5) dt = 5;
  const gph = fuelRate(), mph = D.speed !== undefined ? D.speed / 1.609 : null;
  if (gph === null || mph === null) return;
  const t = F.trip;
  t.gal += gph * dt / 3600; t.miles += mph * dt / 3600; t.secs += dt; if (mph < 1) t.idle += dt; t.last = Date.now();
  F.gph = gph; F.inst = mph >= 2 ? Math.min(99, mph / Math.max(gph, 0.05)) : null;
  pushH('mpg', F.inst === null ? 0 : F.inst);
  if (Date.now() - F.lastSave > 10000) saveFuel();
}
const tripMPG = (t) => (t && t.gal > 0.02 && t.miles > 0.1 ? t.miles / t.gal : null);
const money = (x) => '$' + (x || 0).toFixed(2);
function fillMPGs() {
  const f = F.fills.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.odo || 0) - (b.odo || 0)));
  const out = {};
  let prev = null, galSince = 0;
  f.forEach((x) => {
    if (prev) galSince += x.gal;
    if (x.full && x.odo) {
      if (prev && x.odo > prev.odo && galSince > 0) out[x.id] = (x.odo - prev.odo) / galSince;
      prev = x; galSince = 0;
    }
  });
  return { sorted: f, mpg: out };
}
function monthKey(d) { return d.slice(0, 7); }
function spendStats() {
  const now = new Date(), cur = now.toISOString().slice(0, 7), lastD = new Date(now.getFullYear(), now.getMonth() - 1, 15), last = lastD.toISOString().slice(0, 7);
  const by = {};
  F.fills.forEach((x) => { const k = monthKey(x.date); by[k] = (by[k] || 0) + x.gal * x.ppg; });
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 15); const k = d.toISOString().slice(0, 7); months.push({ k, label: d.toLocaleString('en-US', { month: 'short' }), v: by[k] || 0 }); }
  const keys = Object.keys(by), total = keys.reduce((a, k) => a + by[k], 0);
  const odos = F.fills.filter((x) => x.odo).map((x) => x.odo), miles = odos.length > 1 ? Math.max.apply(null, odos) - Math.min.apply(null, odos) : 0;
  const firstGal = F.fills.length ? F.fills.slice().sort((a, b) => (a.odo || 0) - (b.odo || 0))[0] : null;
  const costForMiles = firstGal ? total - firstGal.gal * firstGal.ppg : total;
  return { cur: by[cur] || 0, last: by[last] || 0, avg: keys.length ? total / keys.length : 0, perMile: miles > 0 ? costForMiles / miles : null, months, total };
}

function renderMpg() {
  const el = $('#mpgbody'); if (!el) return;
  const mode = S.mpgMode || 'trip';
  let h = '<div class="seg" data-seg="mpg"><span class="ind"></span><button data-val="trip">Live Trip</button><button data-val="fills">Fill-Ups</button><button data-val="spend">Spending</button></div>';
  if (mode === 'trip') {
    const live = S.mode === 'live' || S.mode === 'demo';
    h += '<div class="mpggauge"><svg viewBox="0 0 220 128" aria-hidden="true"><path d="M20,118 A90,90 0 0 1 200,118" fill="none" stroke="var(--fill)" stroke-width="16" stroke-linecap="round"/>' +
      '<path id="mpgarc" d="M20,118 A90,90 0 0 1 200,118" fill="none" stroke="var(--green)" stroke-width="16" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" style="transition:stroke-dasharray .4s"/></svg>' +
      '<div class="mg"><b class="num" id="mpg-inst">—</b><span id="mpg-instl">' + (live ? 'Instant MPG' : 'Connect to track') + '</span></div></div>' +
      '<div class="stats4">' + ['Trip MPG|mpg-trip', 'Distance|mpg-mi', 'Fuel used|mpg-gal', 'Trip cost|mpg-cost', 'Idle time|mpg-idle', 'Cost / mile|mpg-cpm']
        .map((x) => { const p = x.split('|'); return '<div class="stat"><span class="cap in">' + p[0] + '</span><b class="num" id="' + p[1] + '">—</b></div>'; }).join('') + '</div>' +
      '<div class="chart" style="height:120px"><svg id="mpgsvg" viewBox="0 0 360 120" preserveAspectRatio="none"></svg></div>' +
      '<div class="btns"><button class="btn tap" data-act="newTrip">Start New Trip</button><button class="btn tap" data-act="setPrice">Gas $' + F.price.toFixed(2) + '/gal</button></div>';
    const recent = F.trips.slice(-6).reverse();
    if (recent.length) {
      h += '<div class="cap">Recent trips</div><div class="group">' + recent.map((t) => {
        const m = tripMPG(t), d = new Date(t.start);
        return '<div class="row"><span class="grow"><span>' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
          '</span><span class="sub num">' + t.miles.toFixed(1) + ' mi · ' + t.gal.toFixed(2) + ' gal</span></span><span class="val num"><b style="color:var(--label)">' + (m ? m.toFixed(1) + ' mpg' : '—') +
          '</b><br><span style="font-size:13px">' + money(t.gal * (t.ppg || F.price)) + '</span></span></div>';
      }).join('') + '</div>';
    }
    h += '<p class="foot">Live MPG is estimated from the engine’s airflow sensor (usually within about 10%). Trips only record while the app is open and connected. Log fill-ups for exact numbers.</p>';
  } else if (mode === 'fills') {
    const r = fillMPGs(), vals = Object.values(r.mpg);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const lastId = r.sorted.length ? r.sorted[r.sorted.length - 1].id : null;
    h += '<button class="btn primary tap" data-act="addFill"><svg class="ic"><use href="#i-pump"/></svg>Add Fill-Up</button>' +
      '<div class="stats"><div class="stat"><span class="cap in">Average MPG</span><b class="num">' + (avg ? avg.toFixed(1) : '—') + '</b></div>' +
      '<div class="stat"><span class="cap in">Last tank</span><b class="num">' + (lastId && r.mpg[lastId] ? r.mpg[lastId].toFixed(1) : '—') + '</b></div></div>';
    if (!r.sorted.length) h += '<div class="empty"><svg class="ic" style="color:var(--sec)"><use href="#i-pump"/></svg><b>No fill-ups yet</b>Each time you get gas, add the gallons, price and odometer. Two full tanks in a row give your real MPG.</div>';
    else h += '<div class="group">' + r.sorted.slice().reverse().map((x) => {
      const m = r.mpg[x.id], d = new Date(x.date + 'T12:00:00');
      return '<button class="row tap" data-act="editFill" data-id="' + x.id + '"><span class="grow"><span>' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        '</span><span class="sub num">' + x.gal.toFixed(2) + ' gal @ $' + x.ppg.toFixed(2) + (x.odo ? ' · ' + x.odo.toLocaleString('en-US') + ' mi' : '') + (x.full ? '' : ' · partial') + '</span></span>' +
        (m ? '<span class="chip green num">' + m.toFixed(1) + ' mpg</span>' : '') + '<span class="val num" style="min-width:64px">' + money(x.gal * x.ppg) + '</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button>';
    }).join('') + '</div>';
  } else {
    const s = spendStats(), mx = Math.max(1, Math.max.apply(null, s.months.map((m) => m.v)));
    h += '<div class="stats4">' + [['This month', money(s.cur)], ['Last month', money(s.last)], ['Avg / month', money(s.avg)], ['Cost / mile', s.perMile ? '$' + s.perMile.toFixed(3) : '—']]
      .map((x) => '<div class="stat"><span class="cap in">' + x[0] + '</span><b class="num">' + x[1] + '</b></div>').join('') + '</div>' +
      '<div class="bars" style="height:220px">' + s.months.map((m) => '<div class="bar"><b class="num" style="font-size:13px">' + (m.v ? '$' + Math.round(m.v) : '') + '</b><div class="track"><div class="fillb" style="height:' + Math.max(2, m.v / mx * 100) + '%;background:var(--green)"></div></div><span>' + m.label.toUpperCase() + '</span></div>').join('') + '</div>' +
      (F.fills.length ? '' : '<p class="foot">Spending comes from your fill-ups. Add one on the Fill-Ups tab.</p>') +
      '<div class="group"><button class="row tap" data-act="setPrice"><span class="grow">Gas price for trip costs</span><span class="val num">$' + F.price.toFixed(2) + '/gal</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button></div>';
  }
  el.innerHTML = h;
  segSet('mpg', mode);
  updateMpg();
}
function updateMpg() {
  if (top() !== 'mpg' || (S.mpgMode || 'trip') !== 'trip') return;
  const t = F.trip || newTrip(), m = tripMPG(t), set = (id, v) => { const e = $('#' + id); if (e) e.textContent = v; };
  const live = S.mode === 'live' || S.mode === 'demo';
  set('mpg-inst', !live ? '—' : F.inst !== null ? F.inst.toFixed(1) : F.gph !== null ? F.gph.toFixed(2) : '—');
  set('mpg-instl', !live ? 'Connect to track' : F.inst !== null ? 'Instant MPG' : F.gph !== null ? 'Idling · gal/hour' : 'Waiting for data');
  const a = $('#mpgarc'); if (a) a.setAttribute('stroke-dasharray', (live && F.inst !== null ? Math.min(100, F.inst / 40 * 100) : 0).toFixed(1) + ' 100');
  set('mpg-trip', m ? m.toFixed(1) : '—'); set('mpg-mi', t.miles.toFixed(1) + ' mi'); set('mpg-gal', t.gal.toFixed(2) + ' gal');
  set('mpg-cost', money(t.gal * F.price)); set('mpg-idle', Math.floor(t.idle / 60) + ' min'); set('mpg-cpm', t.miles > 0.5 ? '$' + (t.gal * F.price / t.miles).toFixed(2) : '—');
  const svg = $('#mpgsvg'), arr = (H.mpg || []).slice(-120);
  if (svg) svg.innerHTML = arr.length > 1 ? '<path d="' + spath(arr, 360, 120, 0, 40, 6) + '" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
    '<text x="352" y="16" text-anchor="end" font-size="11" fill="var(--sec)">40 mpg</text><text x="352" y="114" text-anchor="end" font-size="11" fill="var(--sec)">0</text>' : '';
}
function fillSheet(id) {
  const x = id ? F.fills.find((f) => f.id === id) : null;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const lastOdo = F.fills.reduce((a, f) => Math.max(a, f.odo || 0), 0);
  openSheet(x ? 'Edit Fill-Up' : 'Add Fill-Up',
    '<div class="group">' +
    '<div class="row"><span class="grow">Date</span><input type="date" id="ff-date" value="' + (x ? x.date : today) + '"></div>' +
    '<div class="row"><span class="grow">Gallons</span><input type="number" inputmode="decimal" step="0.001" id="ff-gal" placeholder="12.500" value="' + (x ? x.gal : '') + '"></div>' +
    '<div class="row"><span class="grow">Price per gallon</span><input type="number" inputmode="decimal" step="0.001" id="ff-ppg" placeholder="' + F.price.toFixed(2) + '" value="' + (x ? x.ppg : '') + '"></div>' +
    '<div class="row"><span class="grow">Odometer (mi)</span><input type="number" inputmode="numeric" id="ff-odo" placeholder="' + (lastOdo ? 'last ' + lastOdo : 'optional') + '" value="' + (x && x.odo ? x.odo : '') + '"></div>' +
    '<div class="row"><span class="grow">Filled the tank</span><button class="switch tap' + (!x || x.full ? ' on' : '') + '" id="ff-full" data-act="toggleSwitch" aria-label="Filled the tank"><i></i></button></div>' +
    '</div><div class="ffsum num" id="ff-total">Total $0.00</div>' +
    '<button class="btn primary tap" data-act="saveFill" data-id="' + (x ? x.id : '') + '">Save</button>' +
    (x ? '<button class="btn danger tap" data-act="deleteFill" data-id="' + x.id + '">Delete Fill-Up</button>' : '') +
    '<p class="foot">MPG = miles between two full tanks ÷ gallons added. Partial fills are counted toward the next full tank.</p>');
  const upd = () => { const g = parseFloat($('#ff-gal').value) || 0, p = parseFloat($('#ff-ppg').value) || F.price; $('#ff-total').textContent = 'Total ' + money(g * p); };
  ['#ff-gal', '#ff-ppg'].forEach((s) => $(s).addEventListener('input', upd)); upd();
}
function saveFill(el) {
  const gal = parseFloat($('#ff-gal').value), ppg = parseFloat($('#ff-ppg').value) || F.price, odo = parseInt($('#ff-odo').value, 10) || null, date = $('#ff-date').value;
  if (!(gal > 0) || !(ppg > 0) || !date) { hud('Enter gallons and price', 'i-info'); return; }
  const full = $('#ff-full').classList.contains('on');
  const id = el.dataset.id || ('f' + Date.now());
  const rec = { id, date, gal, ppg, odo, full };
  const i = F.fills.findIndex((f) => f.id === id);
  if (i >= 0) F.fills[i] = rec; else F.fills.push(rec);
  F.price = ppg; store.set('fuel.price', String(ppg));
  saveFuel(); closeSheet(); renderMpg(); renderTiles(); hud('Fill-up saved', 'i-pump');
}
function priceSheet() {
  openSheet('Gas Price', '<div class="group"><div class="row"><span class="grow">Price per gallon</span><input type="number" inputmode="decimal" step="0.001" id="gp" value="' + F.price.toFixed(2) + '"></div></div>' +
    '<button class="btn primary tap" data-act="savePrice">Save</button><p class="foot">Used for trip cost estimates. Adding a fill-up updates it automatically.</p>');
}

// ---------------------------------------------------------------- home
function renderHome() {
  const c = $('#carcard'), on = S.mode === 'live' || S.mode === 'demo';
  const known = VEH || store.get('lastVin', '');
  if (S.mode === 'off') {
    c.innerHTML = (known ? '<div class="stage' + (heroPhoto() ? ' photo' : '') + '">' + heroArt('dim') + '</div>' : '') +
      '<div class="carrow">' + (known ? '' : '<span class="sq" style="background:var(--fill2);color:var(--sec)"><svg class="ic"><use href="#i-bt"/></svg></span>') +
      '<div class="grow"><b>' + (VEH ? esc(vehTitle(VEH)) : 'Not connected') + '</b><span class="s">' + (VEH ? 'Not connected · ' : '') + 'Plug in the adapter and turn the key on</span></div></div>' +
      '<button class="btn primary tap" data-act="connect">Connect Adapter</button><button class="btn tap" data-act="demo" style="height:44px">Try Demo</button>';
  } else if (S.mode === 'connecting') {
    c.innerHTML = (known ? '<div class="stage' + (heroPhoto() ? ' photo' : '') + '">' + heroArt('dim') + '</div>' : '') +
      '<div class="carrow"><div class="spin"></div><div class="grow"><b>Connecting</b><span class="s">' + esc(S.status) + '</span></div></div>';
  } else {
    const photo = heroPhoto();
    c.innerHTML = '<button class="hero tap" data-act="vehicle" aria-label="Vehicle details">' +
      '<div class="stage' + (photo ? ' photo' : '') + '">' + heroArt(S.arrive ? 'on arrive' : 'on') + '</div>' +
      '<div class="carrow"><div class="grow"><b>' + esc(vehicleName()) + (S.mode === 'demo' ? ' <span class="demo">DEMO</span>' : '') + '</b><span class="s">' +
      esc((VEH && vehSub(VEH)) || B.protoDesc || 'Connected') + '</span></div>' +
      '<div class="vpill num"><span class="dot"></span><span id="h-volt">' + (D.volt ? D.volt.toFixed(1) + ' V' : '—') + '</span></div></div></button>' +
      '<div class="mini num"><div><b id="h-rpm">—</b><span>RPM</span></div><div><b id="h-spd">—</b><span id="h-spdu">' + unit('speed').toUpperCase() + '</span></div><div><b id="h-cool">—</b><span>COOLANT</span></div></div>';
  }
  $$('.tile').forEach((t) => { t.style.opacity = on ? '' : '.55'; });
  renderTiles();
  updateHome();
}
function renderTiles() {
  const on = S.mode === 'live' || S.mode === 'demo';
  const n = S.codes ? S.codes.stored.length + S.codes.pending.length : null;
  const b = $('#h-badge'); b.style.display = n ? 'flex' : 'none'; b.textContent = n || '';
  const tc = $('#t-codes');
  tc.textContent = !on ? '—' : S.codesLoading && !S.codes ? 'Reading...' : n === null ? 'Tap to read' : n ? n + ' found' : 'No codes';
  tc.className = 'tv' + (n ? ' red' : '');
  $('#t-ready').textContent = !on ? '—' : S.ready ? S.ready.monitors.filter((m) => m.ready).length + ' of ' + S.ready.monitors.length + ' ready' : 'Tap to check';
  const sc = S.scan;
  $('#t-sys').textContent = !on ? '—' : sc.state === 'done' ? sc.results.length + ' found · ' + sc.results.filter((r) => r.dtcs.length).length + ' w/ codes' : sc.state === 'scanning' ? 'Scanning...' : 'Tap to scan';
  if (S.mis && S.mis.length) { const w = S.mis.reduce((a, x) => (x.cur > a.cur ? x : a), S.mis[0]); $('#t-mis').textContent = w.cur ? 'Cyl ' + w.cyl + ' · ' + w.cur : 'All clear'; }
  else $('#t-mis').textContent = !on ? '—' : 'Tap to read';
  const xa = S.extra.find((x) => x.state === 1);
  $('#t-extra').textContent = !on ? '—' : xa ? 'ATF ' + tempStr(xa.v) : 'Maker data';
}
function updateHome() {
  const on = S.mode === 'live' || S.mode === 'demo';
  if (!on) { ['#t-live', '#t-fuel'].forEach((s) => { $(s).textContent = '—'; }); updateFuelCard(); return; }
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('#h-rpm', fmt('rpm', D.rpm)); set('#h-spd', fmt('speed', D.speed)); set('#h-cool', D.cool === undefined ? '—' : tempStr(D.cool).replace(/°[FC]/, '°'));
  set('#h-volt', D.volt ? D.volt.toFixed(1) + ' V' : '—');
  $('#t-live').textContent = D.rpm === undefined ? 'Tap to view' : fmt('rpm', D.rpm) + ' rpm · ' + fmt('speed', D.speed) + ' ' + unit('speed');
  $('#t-fuel').textContent = D.stft1 !== undefined && D.ltft1 !== undefined ? 'B1 ' + pct(D.stft1 + D.ltft1) : 'Tap to view';
  updateFuelCard();
}
function updateFuelCard() {
  const t = F.trip, m = tripMPG(t), s = spendStats();
  $('#fc-mpg').textContent = m ? m.toFixed(1) : '—';
  $('#fc-sub').textContent = t && t.miles >= 0.1 ? t.miles.toFixed(1) + ' mi · ' + money(t.gal * F.price) + ' this trip' : s.cur ? money(s.cur) + ' on gas this month' : 'Live MPG, trips & fill-ups';
}

// ---------------------------------------------------------------- codes
async function loadCodes() {
  if (!B || S.codesLoading) return;
  S.codesLoading = true; renderCodes(); renderTiles();
  try {
    const r = await job(() => B.codes());
    S.codes = r; S.ff = r.ff;
  } catch (e) { S.codes = { ok: false, mil: false, stored: [], pending: [], permanent: [] }; }
  S.codesLoading = false; renderCodes(); renderTiles();
}
function codeRows(list, tag, cls) {
  return list.map((c) => '<button class="row tap" data-act="openCode" data-code="' + c + '"><span class="grow"><b style="font-weight:600">' + c + '</b><span class="sub">' + esc(dtcText(c, S.makeKey)) +
    '</span></span><span class="chip ' + cls + '">' + tag + '</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button>').join('');
}
function renderCodes() {
  const el = $('#codesbody');
  if (!B) { el.innerHTML = ''; return; }
  if (S.codesLoading && !S.codes) { el.innerHTML = '<div class="loading"><div class="spin"></div>Reading codes...</div>'; return; }
  if (!S.codes) { el.innerHTML = ''; return; }
  const c = S.codes, n = c.stored.length + c.pending.length + c.permanent.length;
  let h = '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0"><span class="dot" style="background:' + (c.mil ? 'var(--red)' : 'var(--green)') + '"></span><b style="font-size:17px;font-weight:600;flex:1">Check engine light ' + (c.mil ? 'on' : 'off') + '</b>' +
    (S.codesLoading ? '<div class="spin" style="width:18px;height:18px"></div>' : '') + '</div>';
  if (!c.ok) h += '<div class="empty"><svg class="ic" style="color:var(--orangeT)"><use href="#i-warn"/></svg><b>Couldn’t read codes</b>Check the key is on, then tap Refresh.</div>';
  else if (!n) h += '<div class="empty"><svg class="ic" style="color:var(--greenT)"><use href="#i-checkc"/></svg><b>No codes stored</b>The engine computer has no trouble codes.</div>';
  else {
    if (c.stored.length) h += '<div class="cap">Stored</div><div class="group">' + codeRows(c.stored, 'Stored', 'red') + '</div>';
    if (c.pending.length) h += '<div class="cap">Pending</div><div class="group">' + codeRows(c.pending, 'Pending', 'orange') + '</div>';
    if (c.permanent.length) h += '<div class="cap">Permanent</div><div class="group">' + codeRows(c.permanent, 'Permanent', 'gray') + '</div><p class="foot">Permanent codes clear themselves after the repair and a few drive cycles.</p>';
  }
  h += '<div class="btns" style="margin-top:6px"><button class="btn tap" data-act="loadCodes"><svg class="ic"><use href="#i-refresh"/></svg>Refresh</button><button class="btn danger tap" data-act="clearEngine">Clear Codes</button></div>';
  el.innerHTML = h;
}
function openCode(code) {
  const ff = S.ff, cell = (v, l) => '<div><b class="num">' + v + '</b><span>' + l + '</span></div>';
  let h = '<div style="font-size:19px;font-weight:600;line-height:24px">' + esc(dtcText(code, S.makeKey)) + '</div>';
  if (ff && ff.code === code) {
    h += '<div class="cap in">Freeze frame · conditions when it set</div><div class="ff">' +
      cell(ff.rpm !== undefined ? Math.round(ff.rpm).toLocaleString('en-US') : '—', 'RPM') + cell(ff.speed !== undefined ? Math.round(conv('speed', ff.speed)) : '—', unit('speed').toUpperCase()) +
      cell(ff.cool !== undefined ? tempStr(ff.cool).replace(/°[FC]/, '°') : '—', 'COOLANT') + cell(ff.load !== undefined ? Math.round(ff.load) + '%' : '—', 'LOAD') +
      cell(ff.stft1 !== undefined ? pct(ff.stft1) : '—', 'SHORT TRIM') + cell(ff.ltft1 !== undefined ? pct(ff.ltft1) : '—', 'LONG TRIM') + '</div>';
  } else if (ff) h += '<p class="foot" style="text-align:left">The freeze frame was saved for ' + ff.code + ', not this code.</p>';
  const cz = CAUSES[code.split('-')[0]];
  if (cz) h += '<div class="cap in">Common causes</div><ul class="causes">' + cz.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  h += '<p class="foot" style="text-align:left">Look the code up for your exact model before buying parts.</p>';
  openSheet(code, h);
}

// ---------------------------------------------------------------- readiness
async function loadReady() {
  if (!B || S.readyLoading) return;
  S.readyLoading = true; renderReady();
  try { S.ready = await job(() => B.readiness()); } catch (e) { S.ready = null; }
  S.readyLoading = false; renderReady(); renderTiles();
}
function renderReady() {
  const el = $('#readybody');
  if (S.readyLoading && !S.ready) { el.innerHTML = '<div class="loading"><div class="spin"></div>Reading monitors...</div>'; return; }
  if (!S.ready) { el.innerHTML = B ? '<div class="empty"><b>No monitor data</b>Tap Refresh with the key on.</div>' : ''; return; }
  const mons = S.ready.monitors, done = mons.filter((m) => m.ready).length, N = mons.length || 1;
  const r = 46, C = 2 * Math.PI * r, seg = C / N, gap = N > 1 ? 6 : 0;
  let ring = '<circle cx="55" cy="55" r="' + r + '" fill="none" stroke="var(--fill)" stroke-width="11"/>';
  mons.forEach((m, i) => {
    ring += '<circle cx="55" cy="55" r="' + r + '" fill="none" stroke="' + (m.ready ? 'var(--green)' : 'var(--orange)') + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="' +
      Math.max(1, seg - gap - 5).toFixed(2) + ' ' + (C - seg + gap + 5).toFixed(2) + '" stroke-dashoffset="' + (-(i * seg) - gap / 2).toFixed(2) + '" transform="rotate(-90 55 55)"/>';
  });
  const notReady = mons.filter((m) => !m.ready);
  el.innerHTML = '<div class="ringcard"><div class="big"><svg viewBox="0 0 110 110" width="110" height="110" role="img" aria-label="' + done + ' of ' + mons.length + ' monitors ready">' + ring + '</svg><b>' + done + '/' + mons.length + '</b></div>' +
    '<p><b>' + (notReady.length ? notReady.length + ' not ready' : 'All ready') + '</b>' + (notReady.length ? 'Many states allow one incomplete monitor on 2001+ vehicles. Monitors complete after normal driving.' : 'Ready for an emissions inspection.') + '</p></div>' +
    '<div class="group">' + mons.map((m) => '<div class="row"><span class="grow">' + m.name + '</span>' +
      (m.ready ? '<svg class="ic" style="color:var(--greenT)"><use href="#i-check"/></svg><span class="val" style="width:84px">Ready</span>'
        : '<svg class="ic" style="color:var(--orangeT)"><use href="#i-clock"/></svg><span class="val" style="width:84px;color:var(--orangeT);font-weight:600">Not ready</span>') + '</div>').join('') + '</div>';
}

// ---------------------------------------------------------------- all systems
const MOD_ICON = (n) => /Engine/.test(n) ? ['i-engine', '#0A84FF'] : /Trans/.test(n) ? ['i-gears', '#30B0C7'] : /ABS|Brake|parking/i.test(n) ? ['i-wheel', '#FF9500']
  : /Airbag/.test(n) ? ['i-seat', '#FF2D55'] : /steer/i.test(n) ? ['i-steer', '#34C759'] : /Hybrid/.test(n) ? ['i-bolt', '#30C452'] : ['i-car', '#5E5CE6'];
function renderSystems() {
  const el = $('#sysbody'), sc = S.scan;
  $('#rescan').style.visibility = sc.state === 'done' ? 'visible' : 'hidden';
  if (!B) { el.innerHTML = ''; return; }
  if (!B.isCAN) { el.innerHTML = '<div class="empty"><svg class="ic" style="color:var(--orangeT)"><use href="#i-info"/></svg><b>Needs a CAN vehicle</b>All Systems works on most 2008+ vehicles (many 2004+). Engine diagnostics still work.</div>'; return; }
  const mk = S.makeKey && VEHICLE_DB[S.makeKey];
  if (sc.state === 'intro') {
    el.innerHTML = '<button class="carcard tap" data-act="pickMake" style="border:0;text-align:left;width:100%"><div class="carrow"><span class="sq" style="background:#5E5CE6;width:46px;height:46px;border-radius:12px"><svg class="ic" style="width:26px;height:26px"><use href="#i-car"/></svg></span>' +
      '<div class="grow"><b>' + esc(mk ? mk.name : 'Choose make') + '</b><span class="s">' + (mk ? mk.modules.length + ' modules in database · tap to change' : 'Tap to choose the vehicle make') + '</span></div><svg class="ic chev" style="color:var(--sec)"><use href="#i-chev-r"/></svg></div></button>' +
      '<p class="foot" style="text-align:left;margin:0 4px">Checks ABS, airbag, transmission, body and more for codes. Key on, engine off is best. Takes 20–60 seconds.</p>' +
      (mk && mk.warnings && mk.warnings._all ? '<div class="tip"><svg class="ic"><use href="#i-info"/></svg><span>' + esc(mk.warnings._all) + '</span></div>' : '') +
      '<button class="btn primary tap" data-act="startScan"' + (mk ? '' : ' disabled') + '>Start Scan</button>';
  } else if (sc.state === 'scanning') {
    const p = sc.n ? (sc.i + 1) / sc.n : 0, C = 2 * Math.PI * 42;
    el.innerHTML = '<div class="center" style="padding-top:30px"><div style="position:relative;width:100px;height:100px"><svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--fill)" stroke-width="8"/>' +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="var(--blue)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (p * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 50 50)" style="transition:stroke-dasharray .2s"/></svg>' +
      '<b class="num" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700">' + Math.round(p * 100) + '%</b></div>' +
      '<div style="display:flex;flex-direction:column;gap:3px"><b style="font-size:21px;font-weight:600;letter-spacing:-.3px">' + esc(sc.name) + '</b><span class="num" style="font-size:15px;color:var(--sec)">Module ' + (sc.i + 1) + ' of ' + sc.n + ' · ' + sc.results.length + ' found</span></div>' +
      '<div class="found">' + sc.results.map((r) => '<span class="chip green">' + esc(r.mod.name.replace(/ \(.*\)/, '')) + '</span>').join('') + '</div></div>';
  } else {
    const withCodes = sc.results.filter((r) => r.dtcs.length).length;
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:0 4px"><b style="font-size:17px;font-weight:600">' + sc.results.length + ' modules responded</b><span style="font-size:15px;font-weight:600;color:' + (withCodes ? 'var(--redT)' : 'var(--greenT)') + '">' + (withCodes ? withCodes + ' with codes' : 'All clear') + '</span></div>' +
      (sc.results.length ? '<div class="group">' + sc.results.map((r, i) => {
        const ic = MOD_ICON(r.mod.name), n = r.dtcs.length;
        const right = !r.readOk ? '<span class="val" style="color:var(--orangeT)">No access</span>' : n ? '<span class="val" style="color:var(--redT);font-weight:600">' + n + (n === 1 ? ' code' : ' codes') + '</span>'
          : '<svg class="ic" style="color:var(--greenT);width:18px;height:18px"><use href="#i-check"/></svg><span class="val">No codes</span>';
        return '<button class="row ic-row tap" data-act="openModule" data-i="' + i + '"><span class="sq sm" style="background:' + ic[1] + '"><svg class="ic"><use href="#' + ic[0] + '"/></svg></span><span class="grow">' + esc(r.mod.name) + '</span>' + right + '<svg class="ic chev"><use href="#i-chev-r"/></svg></button>';
      }).join('') + '</div>' : '<div class="empty"><b>No modules answered</b>Is the key on? Is the right make selected?</div>') +
      '<p class="foot">Modules your vehicle doesn’t have are hidden.</p>';
  }
}
async function startScan() {
  if (!B || S.scan.state === 'scanning' || !S.makeKey) return;
  const mods = modulesFor(S.makeKey);
  S.scan = { state: 'scanning', results: [], i: 0, n: mods.length, name: mods[0].name };
  renderSystems(); renderTiles();
  try {
    const res = await job(() => B.scan(mods, (i, m, out) => { S.scan.i = i; S.scan.name = m.name; S.scan.results = out; if (top() === 'systems') renderSystems(); }));
    S.scan = { state: 'done', results: res, i: 0, n: mods.length, name: '' };
  } catch (e) { S.scan.state = 'intro'; alertBox({ title: 'Scan stopped', msg: e.message || String(e), cancel: false }); }
  renderSystems(); renderTiles();
}
function pickMake() {
  const keys = Object.keys(VEHICLE_DB);
  openSheet('Vehicle Make', '<div class="group">' + keys.map((k) => '<button class="row tap" data-act="setMake" data-k="' + k + '"><span class="grow">' + esc(VEHICLE_DB[k].name) + '</span>' +
    (k === S.makeKey ? '<svg class="ic" style="color:var(--blueT)"><use href="#i-check"/></svg>' : '') + '</button>').join('') + '</div><p class="foot">Detected from the VIN when possible.</p>');
}
function renderModule() {
  const r = S.selMod, el = $('#modbody');
  if (!r) { el.innerHTML = ''; return; }
  $('#m-title').textContent = r.mod.name.replace(/ \/ Brakes/, '');
  const addr = r.mod.tx.toString(16).toUpperCase() + (r.mod.ext >= 0 ? '/' + r.mod.ext.toString(16).toUpperCase().padStart(2, '0') : '');
  const lang = { uds: 'UDS', kwp: 'KWP2000', obd: 'OBD-II' }[r.svc] || '';
  let h = '<span style="font-size:15px;color:var(--sec);padding:0 4px">Module ' + addr + (lang ? ' · ' + lang : '') + '</span>';
  if (r.loading) h += '<div class="loading"><div class="spin"></div>Working...</div>';
  else if (!r.readOk) h += '<div class="empty"><svg class="ic" style="color:var(--orangeT)"><use href="#i-warn"/></svg><b>Codes not readable</b>' + esc(r.note || '') + '</div>';
  else if (!r.dtcs.length) h += '<div class="empty"><svg class="ic" style="color:var(--greenT)"><use href="#i-checkc"/></svg><b>No codes stored</b></div>';
  else {
    h += '<div class="group">' + r.dtcs.map((d) => {
      const tag = AllSystems.tag(r.svc, d.status), cls = tag === 'Active' || tag === 'Stored' ? 'red' : tag === 'Pending' ? 'orange' : 'gray';
      return '<div class="row"><span class="grow"><b style="font-weight:600">' + d.code + '</b><span class="sub">' + esc(dtcText(d.code, S.makeKey)) + '</span></span><span class="chip ' + cls + '">' + tag + '</span></div>';
    }).join('') + '</div>';
    const eng = S.codes ? S.codes.stored.concat(S.codes.pending) : [];
    if (r.dtcs.some((d) => d.code === 'C1249') && eng.includes('P0504')) h += '<div class="tip"><svg class="ic"><use href="#i-info"/></svg><span>C1249 together with engine code P0504 usually points to the brake light switch.</span></div>';
    if (r.dtcs.some((d) => d.code === 'C1201')) h += '<div class="tip"><svg class="ic"><use href="#i-info"/></svg><span>C1201 means the engine computer has a code. Fix the engine code first; C1201 usually clears with it.</span></div>';
  }
  h += '<div class="btns" style="margin-top:6px"><button class="btn tap" data-act="rereadModule">Re-read</button>' + (r.readOk && r.dtcs.length ? '<button class="btn danger tap" data-act="clearModule">Clear Codes</button>' : '<span></span>') + '</div>';
  el.innerHTML = h;
}
async function rereadModule() {
  const r = S.selMod; if (!r || r.loading) return;
  r.loading = true; renderModule();
  try { await job(() => B.reread(r)); } finally { r.loading = false; }
  renderModule(); renderTiles();
}
function clearModule() {
  const r = S.selMod; if (!r) return;
  let warn = r.mod.warn;
  if (!warn && /Airbag/.test(r.mod.name)) warn = 'If the fault is still there, the airbag light comes straight back. Crash data can’t be erased with any scan tool.';
  if (!warn) warn = 'Erases this module’s stored codes. Lights for faults that are still present will come back.';
  alertBox({ title: 'Clear ' + r.mod.name.replace(/ \/ Brakes/, '') + ' codes?', msg: warn, ok: 'Clear', dest: true, onOk: async () => {
    r.loading = true; renderModule();
    let x;
    try { x = await job(() => B.clearModule(r)); } catch (e) { x = { ok: false, msg: e.message }; }
    if (x.ok) { await job(() => B.reread(r)); hud('Codes cleared'); if (/Engine/.test(r.mod.name)) { S.codes = null; loadCodes(); } }
    else alertBox({ title: 'Clear failed', msg: x.msg, cancel: false });
    r.loading = false; renderModule(); renderTiles();
  } });
}

// ---------------------------------------------------------------- live data screens
let liveBuilt = '';
function gaugeSvg(k) {
  return '<svg viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="46" fill="none" stroke="var(--fill)" stroke-width="9" stroke-linecap="round" stroke-dasharray="216.8 289" transform="rotate(135 56 56)"/>' +
    '<circle id="ga-' + k + '" cx="56" cy="56" r="46" fill="none" stroke="' + colVar(P[k].col) + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="0 289" transform="rotate(135 56 56)" style="transition:stroke-dasharray .3s linear"/></svg>';
}
function buildLive() {
  const key = S.tempU + S.speedU + S.graphKey + (B ? B.vin : '');
  if (liveBuilt === key) return; liveBuilt = key;
  const sup = (k) => !B || B.supported(k);
  $('#gauges').innerHTML = GAUGES.map((k) => '<div class="gauge">' + gaugeSvg(k) + '<div class="gv"><b class="num" id="gv-' + k + '">—</b><span>' + unit(k).toUpperCase() + '</span></div><span class="gl">' + P[k].g + (sup(k) ? '' : ' · n/a') + '</span></div>').join('');
  $('#pidlist').innerHTML = PIDS.filter((p) => sup(p.k)).map((p) => '<div class="row"><span class="grow">' + p.n + '</span><svg class="spark" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true"><path id="sp-' + p.k + '" fill="none" stroke="' + colVar(p.col) + '" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>' +
    '<span class="v num"><span id="lv-' + p.k + '">—</span><small>' + unit(p.k) + '</small></span></div>').join('');
  $('#gchips').innerHTML = GRAPHS.filter(sup).map((k) => '<button class="pill tap' + (k === S.graphKey ? ' on' : '') + '" data-act="graphKey" data-k="' + k + '">' + ({ rpm: 'RPM', speed: 'Speed', cool: 'Coolant', load: 'Load', maf: 'Airflow', stft1: 'Short trim' })[k] + '</button>').join('');
  $('#gunit').textContent = unit(S.graphKey);
}
function spath(arr, w, h, min, max, pad) {
  pad = pad || 0;
  const n = arr.length, span = (max - min) || 1;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? (i / (n - 1)) * w : w;
    const y = pad + (1 - Math.min(1, Math.max(0, (arr[i] - min) / span))) * (h - 2 * pad);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
}
function range(arr, lo, hi) {
  if (!arr.length) return [0, 1];
  let mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr);
  if (lo !== undefined) mn = Math.min(mn, lo);
  if (hi !== undefined) mx = Math.max(mx, hi);
  const pad = (mx - mn) * 0.12 || 1;
  return [mn - pad, mx + pad];
}
function updateLive() {
  if (top() !== 'live') return;
  if (S.liveMode === 'gauges') {
    GAUGES.forEach((k) => {
      const p = P[k], v = D[k];
      const f = v === undefined ? 0 : Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min)));
      const a = $('#ga-' + k); if (a) a.setAttribute('stroke-dasharray', (f * 216.8).toFixed(1) + ' 289');
      const e = $('#gv-' + k); if (e) e.textContent = fmt(k, v);
    });
  } else if (S.liveMode === 'list') {
    PIDS.forEach((p) => {
      const e = $('#lv-' + p.k); if (e) e.textContent = fmt(p.k, D[p.k]);
      const sp = $('#sp-' + p.k), arr = (H[p.k] || []).slice(-40);
      if (sp && arr.length > 1) { const r = range(arr); sp.setAttribute('d', spath(arr, 64, 24, r[0], r[1], 2)); }
    });
  } else drawGraph();
}
function drawGraph() {
  const k = S.graphKey, p = P[k], arr = (H[k] || []).map((v) => conv(k, v));
  const W = 360, Ht = 240, t0 = 62, bot = 22, ph = Ht - t0 - bot;
  const r = k === 'rpm' ? range(arr, 0, 2000) : k === 'speed' ? range(arr, 0, conv('speed', 80)) : p.sign ? range(arr, -10, 10) : range(arr);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const y = t0 + (i / 3) * ph, v = r[1] - (i / 3) * (r[1] - r[0]);
    g += '<line x1="0" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--sep)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '<text x="' + (W - 8) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--sec)">' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(Math.abs(v) < 20 && p.d ? 1 : 0)) + '</text>';
  }
  if (arr.length > 1) {
    const line = spath(arr, W, ph, r[0], r[1]).replace(/([ML])([\d.]+) ([\d.]+)/g, (m, c, x, y) => c + x + ' ' + (parseFloat(y) + t0).toFixed(1));
    g += '<defs><linearGradient id="gfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + colVar(p.col) + '" stop-opacity=".3"/><stop offset="1" stop-color="' + colVar(p.col) + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + line + 'L' + W + ' ' + (t0 + ph) + 'L0 ' + (t0 + ph) + 'Z" fill="url(#gfill)"/><path d="' + line + '" fill="none" stroke="' + colVar(p.col) + '" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
  }
  g += '<text x="8" y="' + (Ht - 7) + '" font-size="11" fill="var(--sec)">older</text><text x="' + (W - 8) + '" y="' + (Ht - 7) + '" font-size="11" fill="var(--sec)" text-anchor="end">now</text>';
  $('#gsvg').innerHTML = g;
  $('#gnow').textContent = fmt(k, D[k]);
}
function drawFuel() {
  if (top() !== 'fuel') return;
  const W = 360, Ht = 230, lo = -20, hi = 20, y = (v) => ((1 - (v - lo) / (hi - lo)) * Ht).toFixed(1);
  let g = '<rect x="0" y="' + y(10) + '" width="' + W + '" height="' + (y(-10) - y(10)).toFixed(1) + '" fill="var(--green)" opacity=".09"/>' +
    '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--sep)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
  [10, -10].forEach((v) => { g += '<text x="' + (W - 8) + '" y="' + (parseFloat(y(v)) - 4) + '" text-anchor="end" font-size="11" fill="var(--sec)">' + (v > 0 ? '+' : '') + v + '%</text>'; });
  [['stft1', 'blue', 1], ['ltft1', 'blue', .45], ['stft2', 'orange', 1], ['ltft2', 'orange', .45]].forEach((s) => {
    const a = H[s[0]] || []; if (a.length > 1) g += '<path d="' + spath(a, W, Ht, lo, hi) + '" fill="none" stroke="var(--' + s[1] + ')" stroke-opacity="' + s[2] + '" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
  });
  $('#fsvg').innerHTML = g;
  const tot = (a, b) => (D[a] !== undefined ? D[a] + (D[b] || 0) : null);
  const b1 = tot('stft1', 'ltft1'), b2 = tot('stft2', 'ltft2');
  $('#f-b1').textContent = b1 === null ? '—' : pct(b1); $('#f-b2').textContent = b2 === null ? 'n/a' : pct(b2);
  const st = $('#f-status');
  if (b1 === null) { st.textContent = '—'; st.className = 'chip gray'; }
  else { const ok = Math.abs(b1) < 10 && (b2 === null || Math.abs(b2) < 10); st.textContent = ok ? 'Normal' : 'Check'; st.className = 'chip ' + (ok ? 'green' : 'orange'); }
}

// ---------------------------------------------------------------- misfire
async function loadMis() {
  if (!B || S.misLoading) return;
  S.misLoading = true; renderMis();
  try { S.mis = await job(() => B.misfire()); } catch (e) { S.mis = null; }
  S.misLoading = false; renderMis(); renderTiles();
}
function renderMis() {
  const el = $('#misbody');
  if (S.misLoading && !S.mis) { el.innerHTML = '<div class="loading"><div class="spin"></div>Reading misfire counters...</div>'; return; }
  if (!S.mis) { el.innerHTML = B ? '<div class="empty"><svg class="ic" style="color:var(--orangeT)"><use href="#i-info"/></svg><b>No misfire data</b>' + (B.isCAN ? 'This engine computer doesn’t report per-cylinder counts.' : 'Per-cylinder counts need a CAN vehicle.') + '</div>' : ''; return; }
  const key = S.misMode, data = S.mis.map((m) => m[key]), mx = Math.max(8, Math.max.apply(null, data));
  const worst = data.indexOf(Math.max.apply(null, data));
  el.innerHTML = '<div class="seg" data-seg="mis"><span class="ind"></span><button data-val="cur">This drive</button><button data-val="avg">Recent average</button></div>' +
    '<div class="bars">' + S.mis.map((m, i) => '<div class="bar"><b class="num">' + data[i] + '</b><div class="track"><div class="fillb" style="height:' + Math.max(3, data[i] / mx * 100) + '%;background:' + (i === worst && data[i] >= 3 ? 'var(--orange)' : 'var(--blue)') + '"></div></div><span>CYL ' + m.cyl + '</span></div>').join('') + '</div>' +
    '<div class="tip"><svg class="ic"><use href="#i-info"/></svg><span>' + (data[worst] >= 3 ? 'Cylinder ' + S.mis[worst].cyl + ' is misfiring most. Swap its coil with a neighbouring cylinder; if the misfires move, it’s the coil.' : 'No cylinder stands out. A few counts per drive are normal.') + '</span></div>' +
    '<p class="foot">Counts come from the engine computer’s own misfire monitor (Mode 06). Tap Refresh after a drive.</p>';
  segSet('mis', key);
}

// ---------------------------------------------------------------- extra data
function initExtra() {
  const mk = S.makeKey && VEHICLE_DB[S.makeKey];
  if (!S.extra.length && mk && mk.live) S.extra = mk.live.map((p) => ({ p, v: null, state: 0, fails: 0, h: [] }));
  drawExtra(true);
}
function drawExtra(full) {
  const el = $('#extrabody');
  if (!B) { el.innerHTML = ''; return; }
  if (!S.extra.length) { el.innerHTML = '<div class="empty"><svg class="ic" style="color:var(--sec)"><use href="#i-thermo"/></svg><b>Nothing for this make yet</b>Extra data is only defined for Toyota so far.</div>'; return; }
  const ok = S.extra.filter((x) => x.state === 1).slice(0, 2);
  const key = ok.map((x) => x.p.name).join('|') + S.extra.map((x) => x.state).join('');
  if (full || el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = (ok.length ? '<div class="bigcards">' + ok.map((x, i) => '<div class="bigcard"><span class="cap in">' + esc(x.p.name) + '</span><div class="bv num"><b id="xb' + i + '">—</b><span>' + (S.tempU === 'F' ? '°F' : '°C') + '</span></div><svg id="xs' + i + '" viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true"></svg></div>').join('') + '</div>' : '') +
      '<div class="group">' + S.extra.map((x, i) => '<div class="row"><span class="grow">' + esc(x.p.name) + '</span><span class="val num" id="xr' + i + '"></span></div>').join('') + '</div>' +
      '<p class="foot">Rows are model-year specific; only the matching ones show values. Transmission temperature formulas come from owner forums. Sanity-check them against outside temperature on a cold start.</p>';
  }
  ok.forEach((x, i) => {
    const b = $('#xb' + i); if (b) b.textContent = tempStr(x.v).replace(/°[FC]/, '');
    const s = $('#xs' + i); if (s && x.h.length > 1) { const r = range(x.h); s.innerHTML = '<path d="' + spath(x.h, 160, 28, r[0], r[1], 3) + '" fill="none" stroke="var(--' + (i ? 'green' : 'orange') + ')" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'; }
  });
  S.extra.forEach((x, i) => {
    const e = $('#xr' + i); if (!e) return;
    e.textContent = x.state === 1 ? tempStr(x.v) : x.state === 2 ? 'Not on this vehicle' : 'Checking...';
    e.style.color = x.state === 1 ? 'var(--label)' : '';
  });
}

// ---------------------------------------------------------------- recording
function recTick() {
  if (!S.rec) return;
  const now = performance.now();
  if (now - S.lastRec < 200) return;
  S.lastRec = now;
  S.recRows.push([((now - S.recStart) / 1000).toFixed(1)].concat(PIDS.map((p) => (D[p.k] === undefined ? '' : (+conv(p.k, D[p.k]).toFixed(p.d + 1)).toString()))));
  const s = Math.floor((now - S.recStart) / 1000);
  $('#rectxt').textContent = 'REC ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
async function saveRecording() {
  const header = ['time_s'].concat(PIDS.map((p) => p.k + '_' + unit(p.k).replace('°', 'deg').replace('/', 'per')));
  const csv = [header.join(',')].concat(S.recRows.map((r) => r.join(','))).join('\n');
  const d = new Date(), name = 'scan_' + d.toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.csv';
  if (NativeTransport.available()) { window.webkit.messageHandlers.ble.postMessage({ op: 'share', name, data: csv }); return; }
  try {
    const file = new File([csv], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    hud('Saved ' + name);
  } catch (e) { alertBox({ title: 'Couldn’t save the log', msg: 'This browser blocked the download.', cancel: false }); }
}

// ---------------------------------------------------------------- settings & adapter check
function settings() {
  const seg = (name, opts, cur) => '<div class="seg" data-seg="' + name + '" style="width:170px"><span class="ind"></span>' + opts.map((o) => '<button data-val="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
  const row = (l, ctl) => '<div class="row"><span class="grow">' + l + '</span>' + ctl + '</div>';
  const info = (l, v) => '<div class="row"><span class="grow">' + l + '</span><span class="val num" style="max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v) + '</span></div>';
  let h = '<div class="group">' + row('Appearance', seg('theme', [['dark', 'Dark'], ['light', 'Light']])) + row('Temperature', seg('temp', [['F', '°F'], ['C', '°C']])) + row('Speed', seg('speedu', [['mph', 'mph'], ['kmh', 'km/h']])) + '</div>';
  if (B) {
    h += '<div class="cap">Vehicle</div><div class="group"><button class="row tap" data-act="vehicle"><span class="grow">' + esc(vehicleName()) + '</span><span class="val">Photo, color, details</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button>' +
      info('VIN', B.vin || 'Not reported') + info('Make', S.makeKey ? VEHICLE_DB[S.makeKey].name : 'Unknown') + info('Protocol', B.protoDesc || '—') + '</div>';
    h += '<div class="cap">Adapter</div><div class="group">' + info('Device', B.adapterName) + info('Chip', B.chip || '—') +
      '<button class="row tap" data-act="check"><span class="grow" style="color:var(--blueT)">Run Adapter Check</span><svg class="ic chev"><use href="#i-chev-r"/></svg></button>' +
      '<button class="row tap" data-act="disconnect"><span class="grow" style="color:var(--redT)">' + (S.mode === 'demo' ? 'Exit Demo' : 'Disconnect') + '</span></button></div>';
  } else {
    h += '<div class="group"><button class="row tap" data-act="connect"><span class="grow" style="color:var(--blueT)">Connect Adapter</span></button><button class="row tap" data-act="demo"><span class="grow" style="color:var(--blueT)">Try Demo</span></button></div>';
  }
  h += '<p class="foot">Works with Bluetooth LE OBD adapters (ELM327-compatible or OBDLink CX)' + (NativeTransport.available() ? '.' : ' in the Bluefy browser.') + '</p>';
  openSheet('Settings', h);
  segSet('theme', S.theme); segSet('temp', S.tempU); segSet('speedu', S.speedU);
}
async function runCheck() {
  if (!B) return;
  openSheet('Adapter Check', '<div class="loading"><div class="spin"></div>Testing the adapter...</div>');
  let res;
  try { res = await job(() => B.check()); } catch (e) { res = [{ name: 'Check failed', ok: false, detail: e.message || String(e) }]; }
  const icon = (ok) => ok === true ? '<span class="sq sm" style="background:var(--green)"><svg class="ic"><use href="#i-check"/></svg></span>'
    : ok === false ? '<span class="sq sm" style="background:var(--red)"><svg class="ic"><use href="#i-x"/></svg></span>' : '<span class="sq sm" style="background:#8E8E93"><svg class="ic"><use href="#i-minus"/></svg></span>';
  const bad = res.filter((r) => r.ok === false).map((r) => r.name);
  const verdict = !bad.length ? 'Everything this app needs works with your adapter.'
    : bad.some((b) => /addressed|headers|filter/.test(b)) ? 'Engine diagnostics work, but this adapter can’t talk to individual modules. All Systems and Extra Data need a better adapter (e.g. OBDLink CX).'
    : bad.includes('Extended addressing') ? 'Almost everything works. Toyota body/gateway modules will be skipped in All Systems.' : 'Some features may not work. See the red items.';
  $('#sh-b').innerHTML = '<div class="tip"><svg class="ic"><use href="#i-info"/></svg><span>' + verdict + '</span></div><div class="group">' +
    res.map((r) => '<div class="row ic-row">' + icon(r.ok) + '<span class="grow"><span>' + esc(r.name) + '</span><span class="sub" style="white-space:normal">' + esc(r.detail) + '</span></span></div>').join('') + '</div>';
}

// ---------------------------------------------------------------- refresh
function updateAll() {
  fuelTick();
  const t = top();
  if (t === 'mpg') updateMpg();
  if (t === 'home') updateHome();
  if (t === 'live') updateLive();
  if (t === 'fuel') drawFuel();
  if (S.rec) recTick();
}
function refreshAll() { renderHome(); const t = top(); if (t !== 'home') onShow(t); }

// ---------------------------------------------------------------- actions
const ACT = {
  vehicle: () => vehicleSheet(),
  pickPhoto: () => pickPhoto(),
  choosePic: (el) => {
    if (!VEH) return;
    const k = el.dataset.k;
    if (k === 'own') VEH.useOwn = true;
    else { VEH.useOwn = false; VEH.photoIdx = k === 'art' ? -1 : +k; }
    saveVeh(VEH);
    vehicleSheet(); renderHome();
  },
  removePhoto: () => { if (VEH) { store.set(photoKey(VEH.vin), ''); VEH.useOwn = true; saveVeh(VEH); vehicleSheet(); renderHome(); } },
  setPaint: (el) => { if (!VEH) return; VEH.paint = el.dataset.c; saveVeh(VEH); vehicleSheet(); renderHome(); },
  newTrip: () => { archiveTrip(false); renderMpg(); updateFuelCard(); },
  setPrice: () => priceSheet(),
  savePrice: () => { const x = parseFloat($('#gp').value); if (x > 0) { F.price = x; store.set('fuel.price', String(x)); } closeSheet(); renderMpg(); updateFuelCard(); },
  addFill: () => fillSheet(null),
  editFill: (el) => fillSheet(el.dataset.id),
  saveFill: (el) => saveFill(el),
  deleteFill: (el) => alertBox({ title: 'Delete this fill-up?', ok: 'Delete', dest: true, onOk: () => { F.fills = F.fills.filter((f) => f.id !== el.dataset.id); saveFuel(); closeSheet(); renderMpg(); updateFuelCard(); } }),
  toggleSwitch: (el) => el.classList.toggle('on'),
  connect: () => { closeSheet(); connect(false); },
  demo: () => { closeSheet(); connect(true); },
  disconnect,
  settings, closeSheet,
  check: runCheck,
  loadCodes: () => loadCodes(),
  loadReady: () => loadReady(),
  loadMis: () => loadMis(),
  openCode: (el) => openCode(el.dataset.code),
  clearEngine: () => {
    if (!B) return needConnection();
    alertBox({ title: 'Clear engine codes?', msg: 'This also erases freeze frame data and resets readiness monitors, so the vehicle won’t pass an emissions test until they re-run. Key on, engine off.',
      ok: 'Clear', dest: true, onOk: async () => {
        let ok = false;
        try { ok = await job(() => B.clearCodes()); } catch (e) { ok = false; }
        if (ok) { hud('Codes cleared'); S.codes = null; S.ready = null; loadCodes(); }
        else alertBox({ title: 'Clear failed', msg: 'The engine computer didn’t confirm. Try with the key on and the engine off.', cancel: false });
      } });
  },
  startScan: () => startScan(),
  pickMake,
  setMake: (el) => { S.makeKey = el.dataset.k; store.set('make', S.makeKey); S.extra = []; closeSheet(); renderSystems(); },
  openModule: (el) => { S.selMod = S.scan.results[+el.dataset.i]; push('module'); },
  rereadModule, clearModule,
  graphKey: (el) => { S.graphKey = el.dataset.k; liveBuilt = ''; buildLive(); drawGraph(); },
  rec: () => {
    S.rec = !S.rec; $('#recbtn').classList.toggle('on', S.rec);
    if (S.rec) { S.recRows = []; S.recStart = performance.now(); S.lastRec = 0; $('#rectxt').textContent = 'REC 0:00'; }
    else { $('#rectxt').textContent = 'Record'; if (S.recRows.length) saveRecording(); }
  },
};

document.addEventListener('click', (e) => {
  const segBtn = e.target.closest('.seg button');
  if (segBtn) { onSeg(segBtn.parentElement.dataset.seg, segBtn.dataset.val); return; }
  const g = e.target.closest('[data-go]');
  if (g) { if (S.mode === 'live' || S.mode === 'demo' || g.dataset.go === 'mpg') push(g.dataset.go); else if (S.mode === 'off') needConnection(); return; }
  if (e.target.closest('[data-pop]')) { pop(); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a);
});

// ---------------------------------------------------------------- start
applyTheme();
segSet('live', 'gauges');
(function () { const lv = store.get('lastVin', ''); if (lv) VEH = loadVeh(lv); loadFuel(lv || 'none'); })();
renderHome();
if (!navigator.bluetooth && !NativeTransport.available()) {
  $('.foot').innerHTML = 'Bluetooth isn’t available in this browser. Open this page in <b>Bluefy</b> to connect an adapter. The demo works anywhere.';
}
window.__scanner = { S, D, H, F, connect, push, pop, ACT, getVEH: () => VEH };
})();
