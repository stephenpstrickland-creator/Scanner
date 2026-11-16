// ============================================================================
// Drive Health: watches live data during a drive and flags patterns worth a look.
// Pure logic, no DOM. Values are metric (°C, km/h, V, %). Times are ms from a clock
// the caller passes in, so tests can fast-forward through a whole drive.
//
// Every check only fires on a sustained pattern with enough data, and the wording
// is "might be worth a look", never "this part is bad".
// ============================================================================
const HEALTH_KEYS = ['cool', 'volt', 'stft1', 'ltft1', 'stft2', 'ltft2', 'o2b', 'timing', 'load', 'maf'];
const HEALTH_RANK = { urgent: 3, warn: 2, watch: 1 };
const HEALTH_CHECKS = [
  ['cool', 'Engine temperature'], ['warmup', 'Warm-up (thermostat)'], ['charge', 'Charging system'], ['battery', 'Battery at rest'],
  ['trims', 'Fuel mixture'], ['banks', 'Bank-to-bank balance'], ['cat', 'Catalytic converter'], ['knock', 'Knock (timing)'],
  ['idle', 'Idle smoothness'], ['misfire', 'Misfires'], ['codes', 'New trouble codes'],
];
const HEALTH_MIN = 60000;

class DriveHealth {
  // opt: { disp: litres, temp: (c) => '195°F', has: (key) => supported?, describe: (code) => text }
  constructor(opt = {}) {
    this.disp = opt.disp || 0;
    this.temp = opt.temp || ((c) => Math.round(c) + '°C');
    this.has = opt.has || (() => true);
    this.describe = opt.describe || ((c) => c);
    this.cur = {}; this.start = null; this.last = null; this.rpmT = null;
    this.runMs = 0; this.moveMs = 0;
    this.found = {}; this.events = []; this.timers = {}; this.bins = {};
    this.coolMax = null; this.restVolt = null; this.pending0 = null; this.mis0 = null;
  }

  // ---- input
  feed(t, k, v) {
    if (v === null || v === undefined || isNaN(v)) return;
    if (this.start === null) this.start = t;
    this.last = this.last === null ? t : Math.max(this.last, t);
    this.cur[k] = { v, t };
    if (k === 'rpm') this._clock(t, v);
    if (k === 'cool') this._cool(t, v);
    if (k === 'volt') this._volt(t, v);
    if (k === 'stft1' || k === 'stft2') this._trim(t, +k[4]);
    if (k === 'o2b') this._o2b(v);
    if (k === 'timing') this._timing(v);
    if (k === 'rpm') this._idle(t, v);
  }
  // Pending codes (mode 07), read every few minutes. The first read is the baseline.
  setPending(codes) {
    if (!codes) return;
    if (this.pending0 === null) { this.pending0 = codes.slice(); return; }
    codes.filter((c) => !this.pending0.includes(c)).forEach((c) => this._raise('codes', 'pending_' + c, 'warn', 'New pending code ' + c,
      this.describe(c) + '. The engine computer saw this problem once. If it happens again, the check engine light comes on.'));
  }
  // Per-cylinder misfire counts for this drive cycle (mode 06): [{cyl, cur}]
  setMisfire(list) {
    if (!list || !list.length) return;
    if (!this.mis0) { this.mis0 = {}; list.forEach((m) => { this.mis0[m.cyl] = m.cur; }); return; }
    const d = list.map((m) => ({ cyl: m.cyl, n: m.cur >= (this.mis0[m.cyl] || 0) ? m.cur - (this.mis0[m.cyl] || 0) : m.cur }));
    d.sort((a, b) => b.n - a.n);
    const top = d[0], next = d[1] ? d[1].n : 0;
    if (top.n >= 20 && top.n >= 3 * (next + 1)) this._raise('misfire', 'misfire', 'warn', 'Cylinder ' + top.cyl + ' is misfiring',
      'It misfired ' + top.n + ' times this drive, far more than the others. The usual causes are the spark plug or ignition coil on that cylinder. Swapping its coil with a neighbour shows which one: if the misfires move, it’s the coil.');
    else if (d.length > 2 && d.filter((x) => x.n >= 15).length >= 3) this._raise('misfire', 'misfire_all', 'warn', 'Misfires on several cylinders',
      'Several cylinders misfired during this drive. That points to something shared: worn plugs, a vacuum leak, low fuel pressure or bad fuel.');
  }

  // ---- output
  drain() { const e = this.events; this.events = []; return e; }
  list() { return Object.values(this.found).sort((a, b) => HEALTH_RANK[b.level] - HEALTH_RANK[a.level] || a.at - b.at); }
  worst() { return this.list()[0] || null; }
  checks() {
    const out = [];
    for (const [id, name] of HEALTH_CHECKS) {
      const st = this._state(id);
      if (!st) continue;
      const f = this.list().filter((x) => x.check === id);
      out.push(Object.assign({ id, name }, f.length ? { state: f[0].level, note: f[0].title } : st));
    }
    return out;
  }
  summary() {
    const b = (k) => (this.bins[k] && this.bins[k].n >= 12 ? +this._avg(k).toFixed(1) : null);
    return {
      start: this.start, secs: this.start === null ? 0 : Math.round((this.last - this.start) / 1000), runMin: +(this.runMs / HEALTH_MIN).toFixed(1),
      findings: this.list().map((f) => ({ id: f.id, check: f.check, level: f.level, title: f.title, detail: f.detail })),
      checks: this.checks().map((c) => ({ id: c.id, name: c.name, state: c.state })),
      stats: { trimIdle1: b('trim1_idle'), trimIdle2: b('trim2_idle'), trimCruise1: b('trim1_cruise'), trimCruise2: b('trim2_cruise'),
        coolMax: this.coolMax === null ? null : Math.round(this.coolMax), voltRun: b('volt'), restVolt: this.restVolt },
    };
  }

  // ---- helpers
  get(k, age = 8000) { const c = this.cur[k]; return c && this.last - c.t <= age ? c.v : undefined; }
  running() { return this.get('rpm') > 400; }
  warm() { return this.get('cool', 60000) >= 75; }
  idling() { const s = this.get('speed'); return this.running() && s !== undefined && s < 2 && this.get('rpm') < 1200; }
  cruising() { const s = this.get('speed'), l = this.get('load', 15000); return this.running() && s >= 45 && (l === undefined || (l >= 15 && l <= 75)); }
  _hold(id, cond, t, ms) {
    if (!cond) { this.timers[id] = null; return false; }
    if (this.timers[id] === null || this.timers[id] === undefined) this.timers[id] = t;
    return t - this.timers[id] >= ms;
  }
  _add(k, v, t) {
    const b = this.bins[k] || (this.bins[k] = { n: 0, sum: 0, sq: 0, t0: t, t1: t, low: 0 });
    b.n++; b.sum += v; b.sq += v * v; b.t1 = t === undefined ? b.t1 : t;
    return b;
  }
  _avg(k) { const b = this.bins[k]; return b && b.n ? b.sum / b.n : undefined; }
  _std(k) { const b = this.bins[k]; if (!b || b.n < 2) return undefined; const m = b.sum / b.n; return Math.sqrt(Math.max(0, b.sq / b.n - m * m)); }
  _enough(k, n = 12, ms = HEALTH_MIN) { const b = this.bins[k]; return !!b && b.n >= n && b.t1 - b.t0 >= ms; }
  _raise(check, id, level, title, detail) {
    const old = this.found[id];
    if (old && HEALTH_RANK[old.level] >= HEALTH_RANK[level]) { old.title = title; old.detail = detail; return; }
    const f = { id, check, level, title, detail, at: this.last };
    this.found[id] = f; this.events.push(f);
  }
  _clear(id) { delete this.found[id]; }

  // ---- checks
  _clock(t, rpm) {
    const dt = this.rpmT === null ? 0 : Math.min(10000, Math.max(0, t - this.rpmT));
    this.rpmT = t;
    if (rpm > 400) { this.runMs += dt; if (this.get('speed') > 3) this.moveMs += dt; }
    this._warmup();
  }
  _cool(t, c) {
    this.coolMax = this.coolMax === null ? c : Math.max(this.coolMax, c);
    if (this._hold('hot110', c >= 110, t, 10000)) this._raise('cool', 'overheat', 'urgent', 'Engine is overheating',
      'Coolant reached ' + this.temp(c) + '. Pull over when it’s safe and let it idle or shut it off. Once it has cooled, check the coolant level, look for leaks and make sure the radiator fan runs.');
    else if (this._hold('hot104', c >= 104, t, HEALTH_MIN)) this._raise('cool', 'hot', 'warn', 'Engine running hot',
      'Coolant has stayed around ' + this.temp(c) + ' (normal is about ' + this.temp(85) + '–' + this.temp(98) + '). Check the coolant level when the engine is cold, and that the radiator fan comes on. Towing or hot weather makes it worse.');
    this._warmup();
  }
  _warmup() {
    if (this.coolMax === null || this.found.thermostat) return;
    const amb = this.get('amb', 10 * HEALTH_MIN), need = amb !== undefined && amb < -10 ? 20 * HEALTH_MIN : 10 * HEALTH_MIN;
    if (this.runMs >= need && this.moveMs >= need / 2 && this.coolMax < 71) this._raise('warmup', 'thermostat', 'warn', 'Engine never fully warmed up',
      'After ' + Math.round(this.runMs / HEALTH_MIN) + ' minutes of driving the coolant only reached ' + this.temp(this.coolMax) + ' (normal is about ' + this.temp(85) + '–' + this.temp(98) +
      '). A thermostat stuck open is the usual cause, and it often sets code P0128 later. Weak heat and worse MPG go with it.');
  }
  _volt(t, v) {
    const rpm = this.get('rpm');
    if (rpm !== undefined && rpm < 50 && this.runMs === 0 && this.restVolt === null) {
      this.restVolt = v;
      if (v < 12.2) this._raise('battery', 'battery', 'watch', 'Battery looks low',
        'Before starting it read ' + v.toFixed(1) + ' V. A healthy, charged battery rests around 12.6 V. Have it tested (most parts stores do it free), especially before cold weather.');
    }
    if (!(rpm > 500) || this.runMs < 30000) return;
    this._add('volt', v, t);
    if (this._hold('v126', v < 12.6, t, 20000)) this._raise('charge', 'nocharge', 'urgent', 'Battery isn’t charging',
      'With the engine running it should read 13.5–14.7 V, but it’s at ' + v.toFixed(1) + ' V. The alternator, its belt or the wiring may be failing. The engine is running on the battery alone, so head home or to a shop.');
    else if (this._hold('v130', v < 13.0, t, 2 * HEALTH_MIN)) this._raise('charge', 'lowcharge', 'warn', 'Charging voltage is low',
      'It has stayed around ' + v.toFixed(1) + ' V with the engine running (normal is 13.5–14.7 V). The alternator may be getting weak, or a belt or battery cable may be loose or corroded.');
    if (this._hold('v150', v > 15.0, t, 20000)) this._raise('charge', 'overcharge', 'warn', 'Charging voltage is too high',
      'It’s reading ' + v.toFixed(1) + ' V (normal is 13.5–14.7 V). The alternator’s voltage regulator may be failing. Overcharging can boil the battery and damage electronics.');
  }
  _trim(t, bank) {
    const s = this.get('stft' + bank, 10000), l = this.get('ltft' + bank, 2 * HEALTH_MIN);
    if (s === undefined || !this.warm() || !this.running()) return;
    const tot = s + (l || 0), where = this.idling() ? 'idle' : this.cruising() ? 'cruise' : null;
    if (!where) return;
    this._add('trim' + bank + '_' + where, tot, t);
    this._trimVerdict();
  }
  _trimVerdict() {
    const v = (b, w) => (this._enough('trim' + b + '_' + w) ? this._avg('trim' + b + '_' + w) : undefined);
    const p = (x) => (x > 0 ? '+' : '') + x.toFixed(0) + '%';
    for (const b of [1, 2]) {
      const I = v(b, 'idle'), C = v(b, 'cruise'), bk = 'bank ' + b;
      if (I === undefined && C === undefined) continue;
      const pick = I >= 10 && (C === undefined || C <= I - 5) ? 'vacuum' : I >= 10 && C >= 10 ? 'leanall' : C >= 10 && I < 7 ? 'leanload'
        : I <= -10 || C <= -10 ? 'rich' : Math.max(Math.abs(I || 0), Math.abs(C || 0)) >= 7 ? 'trimhigh' : null;
      ['vacuum', 'leanall', 'leanload', 'rich', 'trimhigh'].forEach((x) => { if (x !== pick) this._clear(x + b); });   // newer data can change the pattern
      if (pick === 'vacuum' && (C === undefined || C <= I - 5)) this._raise('trims', 'vacuum' + b, 'warn', 'Running lean at idle (' + bk + ')',
        'The engine computer is adding ' + p(I) + ' fuel at idle' + (C !== undefined ? ' but only ' + p(C) + ' when cruising' : '') + '. Lean at idle and better at speed usually means a vacuum leak: a cracked hose, PCV hose or intake gasket. Listen for a hiss with the engine running.');
      else if (pick === 'leanall') this._raise('trims', 'leanall' + b, 'warn', 'Running lean everywhere (' + bk + ')',
        'It’s adding about ' + p((I + C) / 2) + ' fuel at idle and at speed. That usually means the airflow (MAF) sensor reads low, so try cleaning it with MAF cleaner first. A weak fuel pump or clogged filter is next.');
      else if (pick === 'leanload') this._raise('trims', 'leanload' + b, 'warn', 'Running lean under load (' + bk + ')',
        'Fine at idle but adding ' + p(C) + ' fuel when cruising. That pattern points to fuel delivery: a weak fuel pump, clogged fuel filter or dirty injectors. A dirty MAF sensor can do it too.');
      else if (pick === 'rich') this._raise('trims', 'rich' + b, 'warn', 'Running rich (' + bk + ')',
        'The engine computer is pulling ' + p(Math.min(I === undefined ? 0 : I, C === undefined ? 0 : C)) + ' fuel out. Common causes: a leaking injector, a dirty air filter, a MAF sensor reading high, or a fuel pressure regulator stuck closed.');
      else if (pick === 'trimhigh') this._raise('trims', 'trimhigh' + b, 'watch', 'Fuel trim a little high (' + bk + ')',
        'It’s correcting the fuel by about ' + p(Math.abs(I || 0) > Math.abs(C || 0) ? I : C) + '. Under 10% is still OK, but if it keeps creeping up there may be a small vacuum leak or a dirty MAF sensor.');
    }
    for (const w of ['idle', 'cruise']) {
      const a = v(1, w), c = v(2, w);
      if (a === undefined || c === undefined || Math.abs(a - c) < 8) continue;
      const lean = a > c ? 1 : 2;
      this._raise('banks', 'banks', 'warn', 'Bank ' + lean + ' is leaner than bank ' + (3 - lean),
        'At ' + w + ' bank 1 is at ' + p(a) + ' and bank 2 at ' + p(c) + '. When only one side is off, look on that side: a vacuum leak at its intake runners, a clogged injector, or an exhaust leak before its O2 sensor. Bank 1 is the side with cylinder 1.');
    }
  }
  _o2b(v) {
    if (!this.warm() || !this.cruising() || this.runMs < 5 * HEALTH_MIN) return;
    const b = this._add('o2b', v, this.last);
    if (b.n >= 40 && this._std('o2b') > 0.25) this._raise('cat', 'cat', 'watch', 'Catalytic converter may be wearing',
      'The rear O2 sensor is swinging up and down almost like the front one. A healthy converter keeps it fairly steady. This often shows up months before code P0420. Fix any misfires or exhaust leaks first, since they can cause it.');
  }
  _timing(v) {
    const load = this.get('load', 5000), rpm = this.get('rpm', 5000);
    if (!this.warm() || !(load >= 50) || !(rpm >= 1200 && rpm <= 4500)) return;
    const b = this._add('knock', v, this.last);
    if (v <= 0) b.low++;
    if (b.low >= 5 && b.low / b.n >= 0.3) this._raise('knock', 'knock', 'watch', 'Timing pulled back under load',
      'When you accelerate, the engine computer keeps retarding the ignition timing, which it does when it hears knock. Try a tank of the octane the owner’s manual asks for. If it continues, carbon buildup or a knock sensor problem are the next things to check.');
  }
  _idle(t, rpm) {
    const prev = this.prevIdle;
    if (!this.warm() || !this.idling()) { this.prevIdle = null; return; }
    this.prevIdle = { t, rpm };
    if (!prev || t - prev.t > 4000) return;
    const b = this._add('idle', Math.abs(rpm - prev.rpm), t);
    if (b.n >= 30 && b.sum / b.n > 50) this._raise('idle', 'roughidle', 'watch', 'Idle is unsteady',
      'Engine speed at idle keeps jumping by about ' + Math.round(b.sum / b.n) + ' rpm (a smooth idle varies by 10–20). Common causes: a dirty throttle body, a vacuum leak, or a weak plug or coil. Check the Misfire screen too.');
  }

  // state of a check with no finding: {state: 'ok'|'wait', note} or null when this vehicle can't do it
  _state(id) {
    const ok = (note) => ({ state: 'ok', note }), wait = (note) => ({ state: 'wait', note });
    switch (id) {
      case 'cool': return !this.has('cool') ? null : this.coolMax === null ? wait('Waiting for data') : ok('Highest ' + this.temp(this.coolMax));
      case 'warmup': return !this.has('cool') ? null : this.coolMax >= 75 ? ok('Reached ' + this.temp(this.coolMax)) : wait('Needs about 10 minutes of driving');
      case 'charge': return !this.has('volt') ? null : this.bins.volt && this.bins.volt.n >= 5 ? ok('About ' + this._avg('volt').toFixed(1) + ' V') : wait('Needs the engine running');
      case 'battery': return !this.has('volt') ? null : this.restVolt !== null ? ok(this.restVolt.toFixed(1) + ' V before starting') : wait('Checked when you connect before starting');
      case 'trims': return !this.has('stft1') ? null : ['trim1_idle', 'trim1_cruise'].some((k) => this._enough(k)) ? ok('Within normal range') : wait('Needs a few minutes warm, idling and cruising');
      case 'banks': return !this.has('stft2') ? null : ['idle', 'cruise'].some((w) => this._enough('trim1_' + w) && this._enough('trim2_' + w)) ? ok('Both sides match') : wait('Needs a few minutes warm');
      case 'cat': return !this.has('o2b') ? null : this.bins.o2b && this.bins.o2b.n >= 40 ? ok('Rear O2 sensor steady') : wait('Needs steady cruising after warm-up');
      case 'knock': return !this.has('timing') ? null : this.bins.knock && this.bins.knock.n >= 10 ? ok('No sign of knock') : wait('Needs some firmer acceleration');
      case 'idle': return this.bins.idle && this.bins.idle.n >= 30 ? ok('Smooth') : wait('Needs a minute at idle when warm');
      case 'misfire': return !this.has('misfire') ? null : this.mis0 ? ok('No cylinder stands out') : wait('Checked a few minutes in');
      case 'codes': return this.pending0 !== null ? ok('None new this drive') : wait('Checked a few minutes in');
    }
    return null;
  }
}
