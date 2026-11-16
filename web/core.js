// ============================================================================
// OBD core: Bluetooth LE transport, ELM327/STN command layer, OBD-II services
// and the manufacturer "all systems" engine. Same logic as the ESP32 firmware
// (src/enhanced.h), ported to JavaScript. Needs db.js (VEHICLE_DB, DTC_GENERIC).
// ============================================================================

// Serial-over-BLE services used by ELM327-style adapters. FFF0 is used by
// OBDLink CX and most clones; the others cover common clone/Vgate variants.
const BLE_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000beef-0000-1000-8000-00805f9b34fb',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared prompt-based serial logic: collect bytes until the ELM ">" prompt.
class SerialBase {
  constructor() { this.buf = ''; this.waiter = null; this.onDisconnect = null; this.onStatus = null; }
  _onText(s) { this.buf += s; this._check(); }
  _check() {
    const i = this.buf.indexOf('>');
    if (this.waiter && i >= 0) {
      const w = this.waiter; this.waiter = null;
      const out = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      w(out);
    }
  }
  request(cmd, timeoutMs) {
    this.buf = '';
    return new Promise((resolve) => {
      const w = (s) => { clearTimeout(timer); resolve(s); };
      const timer = setTimeout(() => {
        if (this.waiter === w) { this.waiter = null; const b = this.buf; this.buf = ''; resolve(b + '\rTIMEOUT'); }
      }, timeoutMs);
      this.waiter = w;
      Promise.resolve().then(() => this._write(cmd + '\r')).catch((e) => { if (this.waiter === w) { this.waiter = null; clearTimeout(timer); resolve('\rERROR ' + e.message); } });
    });
  }
}

// Web Bluetooth (Bluefy / Chrome).
class BleTransport extends SerialBase {
  constructor() { super(); this.dev = null; this.rx = null; this.tx = null; }

  async connect() {
    if (!navigator.bluetooth) throw new Error('This browser has no Bluetooth. Open the page in Bluefy.');
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    this.dev = dev;
    dev.addEventListener('gattserverdisconnected', () => { if (this.onDisconnect) this.onDisconnect(); });
    if (this.onStatus) this.onStatus('Connecting to ' + (dev.name || 'adapter') + '...');
    const server = await dev.gatt.connect();
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      let chars;
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      let r = null, t = null;
      for (const c of chars) {
        const p = c.properties;
        if (!r && (p.notify || p.indicate)) r = c;
        if (!t && (p.write || p.writeWithoutResponse)) t = c;
      }
      if (r && t) { this.rx = r; this.tx = t; break; }
    }
    if (!this.rx) throw new Error('This adapter has no serial service I recognise.');
    await this.rx.startNotifications();
    this.rx.addEventListener('characteristicvaluechanged', (e) => {
      const dv = e.target.value; let s = '';
      for (let i = 0; i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(i));
      this._onText(s);
    });
    return dev.name || 'OBD adapter';
  }

  disconnect() { try { if (this.dev && this.dev.gatt.connected) this.dev.gatt.disconnect(); } catch (e) { /* ignore */ } }

  async _write(str) {
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i += 20) {          // 20 bytes fits every BLE MTU
      const part = bytes.slice(i, i + 20);
      const p = this.tx.properties;
      if (p.write && this.tx.writeValueWithResponse) await this.tx.writeValueWithResponse(part);
      else if (p.writeWithoutResponse && this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(part);
      else await this.tx.writeValue(part);
    }
  }
}

// Native iPhone app: CoreBluetooth lives in Swift (BLEBridge.swift); this talks to it.
class NativeTransport extends SerialBase {
  static available() { return !!(typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ble); }
  constructor() {
    super(); this.pending = null;
    window.__nativeBle = {
      onStatus: (s) => { if (this.onStatus) this.onStatus(s); },
      onConnected: (n) => { const p = this.pending; this.pending = null; if (p) p.res(n || 'OBD adapter'); },
      onError: (m) => {
        const p = this.pending; this.pending = null;
        if (p) { const e = new Error(m === 'cancel' ? 'Cancelled' : m); if (m === 'cancel') e.name = 'NotFoundError'; p.rej(e); }
      },
      onData: (s) => this._onText(s),
      onDisconnect: () => { if (this.onDisconnect) this.onDisconnect(); },
    };
  }
  _post(m) { window.webkit.messageHandlers.ble.postMessage(m); }
  connect() { return new Promise((res, rej) => { this.pending = { res, rej }; this._post({ op: 'connect' }); }); }
  disconnect() { try { this._post({ op: 'disconnect' }); } catch (e) { /* ignore */ } }
  _write(str) { this._post({ op: 'write', data: str }); }
}

// ---------------------------------------------------------------- helpers
const hexVal = (c) => { const v = parseInt(c, 16); return isNaN(v) ? -1 : v; };
function hexToBytes(s) {
  const b = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const hi = hexVal(s[i]), lo = hexVal(s[i + 1]);
    if (hi < 0 || lo < 0) break;
    b.push(hi * 16 + lo);
  }
  return b;
}
function decodeDTC(a, b) {
  return 'PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + (b >> 4).toString(16).toUpperCase() + (b & 15).toString(16).toUpperCase();
}
const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const h3 = (n) => n.toString(16).toUpperCase().padStart(3, '0');

// Reassemble ISO-TP ("0:", "1:"...) and single-line replies; drops CAN padding.
function toMessages(L) {
  const msgs = [], want = [];
  let pending = -1;
  for (const line of L) {
    const colon = line.indexOf(':');
    if (colon === 1 || colon === 2) {
      const idx = parseInt(line.slice(0, colon), 16) || 0;
      const part = hexToBytes(line.slice(colon + 1));
      if (idx === 0 || !msgs.length) { msgs.push([]); want.push(pending); pending = -1; }
      msgs[msgs.length - 1].push(...part);
    } else if (line.length % 2 === 1) {
      pending = /^[0-9A-F]+$/.test(line) ? parseInt(line, 16) : -1;
    } else {
      const b = hexToBytes(line);
      if (b.length) { msgs.push(b); want.push(-1); }
    }
  }
  msgs.forEach((m, i) => { if (want[i] > 0 && m.length > want[i]) m.length = want[i]; });
  return msgs;
}
const hasError = (L) => L.some((s) => /NODATA|UNABLETOCONNECT|ERROR|STOPPED|TIMEOUT|BUSBUSY|CANERROR/.test(s) || s === '?');

// ---------------------------------------------------------------- PID decoders (metric)
const PID_DEC = {
  0x04: (d) => d[0] * 100 / 255,
  0x05: (d) => d[0] - 40,
  0x06: (d) => (d[0] - 128) * 100 / 128, 0x07: (d) => (d[0] - 128) * 100 / 128,
  0x08: (d) => (d[0] - 128) * 100 / 128, 0x09: (d) => (d[0] - 128) * 100 / 128,
  0x0B: (d) => d[0],
  0x0C: (d) => (d[0] * 256 + d[1]) / 4,
  0x0D: (d) => d[0],
  0x0E: (d) => d[0] / 2 - 64,
  0x0F: (d) => d[0] - 40,
  0x10: (d) => (d[0] * 256 + d[1]) / 100,
  0x11: (d) => d[0] * 100 / 255,
  0x14: (d) => d[0] / 200,
  0x1F: (d) => d[0] * 256 + d[1],
  0x2F: (d) => d[0] * 100 / 255,
  0x33: (d) => d[0],
  0x42: (d) => (d[0] * 256 + d[1]) / 1000,
  0x46: (d) => d[0] - 40,
  0x5C: (d) => d[0] - 40,
};
const PID_LEN = { 0x0C: 2, 0x10: 2, 0x1F: 2, 0x42: 2 };

// ---------------------------------------------------------------- ELM layer
class Elm {
  constructor(transport) {
    this.t = transport; this.q = Promise.resolve();
    this.reset();
  }
  reset() {
    this.connected = false; this.proto = 0; this.protoDesc = ''; this.vin = ''; this.volts = null; this.id = ''; this.stn = '';
    this.sup = new Array(0x61).fill(false); this.noSuffix = false;
    // enhanced-session state
    this.curProto = 0; this.ceaOk = true; this.selTx = 0; this.selExt = -1; this.extUsed = false; this.enhActive = false;
  }
  isCAN() { return this.proto >= 6 && this.proto <= 9; }

  raw(cmd, ms = 2000) {
    const p = this.q.then(() => this.t.request(cmd, ms));
    this.q = p.catch(() => {});
    return p;
  }
  async lines(cmd, ms = 2000) {
    const r = await this.raw(cmd, ms);
    const want = cmd.replace(/ /g, '').toUpperCase();
    const out = [];
    for (const line of r.split(/[\r\n]+/)) {
      const ns = line.trim().replace(/ /g, '').toUpperCase();
      if (!ns || ns === want || ns.startsWith('SEARCHING') || ns.startsWith('BUSINIT')) continue;
      out.push(ns);
    }
    return out;
  }
  async atOK(cmd) { return (await this.lines(cmd, 1000)).some((s) => s.indexOf('OK') >= 0); }

  markSupported(base, d) {
    if (d.length < 4) return;
    const mask = ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
    for (let i = 0; i < 32; i++) { const pid = base + 1 + i; if (pid <= 0x60) this.sup[pid] = !!((mask >>> (31 - i)) & 1); }
  }

  async queryPID(pid, ms = 1500) {
    const base = '01' + h2(pid);
    let L = await this.lines(this.isCAN() && !this.noSuffix ? base + '1' : base, ms);
    if (this.isCAN() && !this.noSuffix && L.includes('?')) { this.noSuffix = true; L = await this.lines(base, ms); }
    if (hasError(L)) return null;
    for (const m of toMessages(L)) if (m.length >= 2 && m[0] === 0x41 && m[1] === pid) return m.slice(2);
    return null;
  }
  async readPID(pid) {
    const d = await this.queryPID(pid);
    if (!d || d.length < (PID_LEN[pid] || 1) || !PID_DEC[pid]) return null;
    return PID_DEC[pid](d);
  }

  async readDTCs(mode) {
    const L = await this.lines(h2(mode), 5000);
    if (L.some((s) => s.indexOf('NODATA') >= 0)) return [];
    if (hasError(L)) return null;
    const out = [];
    for (const m of toMessages(L)) {
      if (!m.length || m[0] !== mode + 0x40) continue;
      let start = 1, end = m.length;
      if (this.isCAN() && m.length >= 2) { start = 2; end = Math.min(m.length, 2 + 2 * m[1]); }
      for (let i = start; i + 1 < end; i += 2) {
        if (m[i] === 0 && m[i + 1] === 0) continue;
        const c = decodeDTC(m[i], m[i + 1]);
        if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  async readVoltage() {
    for (const s of await this.lines('ATRV', 1000)) { const v = parseFloat(s); if (s.endsWith('V') && !isNaN(v)) { this.volts = v; return v; } }
    return null;
  }

  async readVIN() {
    const L = await this.lines('0902', 5000);
    if (hasError(L)) return '';
    let v = '';
    for (const m of toMessages(L)) {
      if (m.length < 3 || m[0] !== 0x49 || m[1] !== 0x02) continue;
      for (let i = 3; i < m.length; i++) { const c = String.fromCharCode(m[i]); if (/[A-Z0-9]/i.test(c)) v += c; }
    }
    this.vin = v.length >= 17 ? v.slice(-17).toUpperCase() : '';
    return this.vin;
  }

  async connect(status) {
    this.reset();
    status = status || (() => {});
    status('Waking adapter...');
    let id = await this.raw('ATZ', 3000);
    await sleep(400);
    if (!/ELM|STN|OBD|V\d/i.test(id)) id = await this.raw('ATI', 1500);
    if (!/ELM|STN|OBD|V\d/i.test(id)) throw new Error('Adapter did not answer. Is it plugged in?');
    this.id = (id.match(/(ELM327|STN\d+|OBD\w*)[^\r\n>]*/i) || [id.trim()])[0].trim();
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) await this.raw(c, 1000);
    const sti = (await this.lines('STI', 1000)).find((s) => /STN/.test(s));
    this.stn = sti || '';
    await this.readVoltage();
    status('Searching for the vehicle...');
    const L = await this.lines('0100', 20000);
    const m = toMessages(L).find((x) => x.length >= 6 && x[0] === 0x41 && x[1] === 0x00);
    if (!m) throw new Error('No reply from the vehicle. Is the ignition on?');
    this.markSupported(0x00, m.slice(2));
    const dpn = await this.lines('ATDPN', 1000);
    if (dpn.length) this.proto = hexVal(dpn[0].replace(/^A/, '')[0]);
    let dp = await this.raw('ATDP', 1000);
    this.protoDesc = dp.replace(/ATDP/g, '').replace(/AUTO,\s*/g, '').replace(/[\r\n]+/g, ' ').trim();
    for (const b of [0x20, 0x40]) if (this.sup[b]) { const d = await this.queryPID(b); if (d) this.markSupported(b, d); }
    status('Reading VIN...');
    await this.readVIN();
    this.connected = true;
    this.curProto = this.proto;
    return true;
  }

  // ---- readiness monitors (PID 01)
  async readiness() {
    const d = await this.queryPID(0x01);
    if (!d || d.length < 4) return null;
    const mil = !!(d[0] & 0x80), count = d[0] & 0x7F, diesel = !!(d[1] & 0x08);
    const mons = [
      ['Misfire', d[1] & 0x01, d[1] & 0x10], ['Fuel system', d[1] & 0x02, d[1] & 0x20], ['Components', d[1] & 0x04, d[1] & 0x40],
    ];
    if (!diesel) {
      ['Catalyst', 'Heated catalyst', 'EVAP system', 'Secondary air', 'A/C refrigerant', 'O2 sensor', 'O2 heater', 'EGR / VVT']
        .forEach((n, i) => mons.push([n, d[2] & (1 << i), d[3] & (1 << i)]));
    }
    return { mil, count, diesel, monitors: mons.filter((x) => x[1]).map((x) => ({ name: x[0], ready: !x[2] })) };
  }

  // ---- freeze frame (mode 02, frame 0)
  async freezeFrame() {
    const L = await this.lines('020200', 2000);
    const m = toMessages(L).find((x) => x[0] === 0x42 && x[1] === 0x02);
    if (!m || m.length < 5 || (m[3] === 0 && m[4] === 0)) return null;
    const ff = { code: decodeDTC(m[3], m[4]) };
    for (const [k, pid] of [['rpm', 0x0C], ['speed', 0x0D], ['cool', 0x05], ['load', 0x04], ['stft1', 0x06], ['ltft1', 0x07]]) {
      const LL = await this.lines('02' + h2(pid) + '00', 1500);
      const mm = toMessages(LL).find((x) => x[0] === 0x42 && x[1] === pid);
      if (mm && mm.length >= 3 + (PID_LEN[pid] || 1)) ff[k] = PID_DEC[pid](mm.slice(3));
    }
    return ff;
  }

  // ---- per-cylinder misfire counts (mode 06, CAN only)
  async misfire() {
    if (!this.isCAN()) return null;
    let mids = [];
    const L0 = await this.lines('06A0', 2000);
    const s = toMessages(L0).find((x) => x[0] === 0x46 && x[1] === 0xA0 && x.length >= 6);
    if (s) { for (let i = 0; i < 32; i++) if ((s[2 + (i >> 3)] >> (7 - (i & 7))) & 1) { const mid = 0xA1 + i; if (mid >= 0xA2 && mid <= 0xAD) mids.push(mid); } }
    if (!mids.length) mids = [0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7];
    const out = [];
    for (const mid of mids) {
      const L = await this.lines('06' + h2(mid), 2000);
      let cur = null, avg = null;
      for (const m of toMessages(L)) {
        if (m[0] !== 0x46) continue;
        for (let i = 1; i + 9 <= m.length; i += 9) {
          if (m[i] !== mid) continue;
          const v = m[i + 3] * 256 + m[i + 4];
          if (m[i + 1] === 0x0C) cur = v;
          if (m[i + 1] === 0x0B) avg = v;
        }
      }
      if (cur === null && avg === null) { if (out.length) break; continue; }
      out.push({ cyl: mid - 0xA1, cur: cur || 0, avg: avg || 0 });
    }
    return out.length ? out : null;
  }

  // ================================================================ enhanced (all systems)
  static is29(id) { return id > 0x7FF; }

  enhBegin() { this.curProto = this.proto; this.selTx = 0; this.selExt = -1; this.extUsed = false; this.enhActive = true; }
  async enhEnd() {
    if (!this.enhActive) return;
    if (this.extUsed) { await this.atOK('ATCEA'); await this.atOK('ATTAF1'); }
    await this.atOK('ATFCSM0'); await this.atOK('ATAR'); await this.atOK('ATCP18');
    if (this.curProto !== this.proto) { await this.atOK('ATSP' + this.proto.toString(16).toUpperCase()); this.curProto = this.proto; }
    await this.atOK(this.proto === 7 || this.proto === 9 ? 'ATSHDB33F1' : 'ATSH7DF');
    this.selTx = 0; this.selExt = -1; this.extUsed = false; this.enhActive = false;
  }
  async setProtoFor(tx) {
    let want = this.proto;
    if (Elm.is29(tx)) { if (want === 6) want = 7; else if (want === 8) want = 9; }
    else { if (want === 7) want = 6; else if (want === 9) want = 8; }
    if (want === this.curProto) return true;
    if (!(await this.atOK('ATSP' + want.toString(16).toUpperCase()))) return false;
    this.curProto = want; return true;
  }
  async modSelect(tx, ext) {
    if (!this.isCAN()) return false;
    if (ext >= 0 && !this.ceaOk) return false;
    if (tx === this.selTx && ext === this.selExt) return true;
    if (!this.enhActive) this.enhBegin();
    if (!(await this.setProtoFor(tx))) return false;
    if (Elm.is29(tx)) {
      const rx = ((tx & 0xFFFF0000) >>> 0) + ((tx << 8) & 0xFF00) + ((tx >>> 8) & 0xFF);
      await this.atOK('ATCP' + h2(tx >>> 24));
      if (!(await this.atOK('ATSH' + (tx & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0')))) return false;
      if (!(await this.atOK('ATCRA' + rx.toString(16).toUpperCase().padStart(8, '0')))) return false;
      if (!(await this.atOK('ATFCSH' + tx.toString(16).toUpperCase().padStart(8, '0')))) return false;
    } else {
      if (!(await this.atOK('ATSH' + h3(tx)))) return false;
      if (!(await this.atOK('ATCRA' + h3(tx + 8)))) return false;
      if (!(await this.atOK('ATFCSH' + h3(tx)))) return false;
    }
    if (ext >= 0) {
      if (!(await this.atOK('ATCEA' + h2(ext)))) { this.ceaOk = false; this.selTx = 0; return false; }
      this.extUsed = true;
      await this.atOK('ATTA' + h2(ext));
      if (!(await this.atOK('ATFCSD' + h2(ext) + '300000'))) return false;
    } else {
      if (this.extUsed) { await this.atOK('ATCEA'); await this.atOK('ATTAF1'); this.extUsed = false; }
      if (!(await this.atOK('ATFCSD300000'))) return false;
    }
    if (!(await this.atOK('ATFCSM1'))) return false;
    this.selTx = tx; this.selExt = ext;
    return true;
  }
  // -> {r:'pos'|'neg'|'none', msg, nrc}
  async enhRequest(hex, ms = 3000) {
    const sid = parseInt(hex.slice(0, 2), 16);
    const L = await this.lines(hex, ms);
    let neg = null;
    for (let m of toMessages(L)) {
      if (this.selExt >= 0 && m.length > 1 && m[0] === this.selExt && (m[1] === 0x7F || m[1] === sid + 0x40)) m = m.slice(1);
      if (m.length >= 3 && m[0] === 0x7F && m[1] === sid) { if (m[2] === 0x78) continue; neg = m[2]; continue; }
      if (m.length && m[0] === sid + 0x40) return { r: 'pos', msg: m };
    }
    return neg !== null ? { r: 'neg', nrc: neg } : { r: 'none' };
  }
}

const NRC_TEXT = {
  0x10: 'Module rejected the request', 0x11: 'Service not supported', 0x12: 'Sub-function not supported',
  0x13: 'Wrong message length', 0x21: 'Module busy - try again', 0x22: 'Conditions not correct (key on, engine off?)',
  0x31: 'Request out of range', 0x33: 'Security access required (dealer tool)', 0x7E: 'Needs a dealer diagnostic session',
  0x7F: 'Needs a dealer diagnostic session',
};
const nrcText = (n) => NRC_TEXT[n] || 'Module refused';

// ---------------------------------------------------------------- vehicle database helpers
function makeFromVIN(vin) {
  let best = null, len = 0;
  if (!vin || vin.length < 3) return null;
  for (const [key, mk] of Object.entries(VEHICLE_DB)) for (const w of mk.wmi) if (vin.startsWith(w) && w.length > len) { best = key; len = w.length; }
  return best;
}
function modelYear(vin) {
  if (!vin || vin.length < 17) return null;
  const codes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const i = codes.indexOf(vin[9]);
  if (i < 0) return null;
  let y = 1980 + i;
  if (/[A-Z]/.test(vin[6]) && y < 2010) y += 30;
  return y;
}
function modulesFor(key) {
  const mk = VEHICLE_DB[key];
  return mk.modules.map((m) => ({
    name: m.name, tx: parseInt(m.tx, 16), ext: m.ext ? parseInt(m.ext, 16) : -1,
    proto: m.proto.split('+'),
    warn: (mk.warnings || {})[m.tx + (m.ext ? '/' + m.ext : '')] || (!m.ext ? (mk.warnings || {})[m.tx] : null) || null,
  }));
}
function dtcText(code, makeKey) {
  const base = code.split('-')[0];
  if (makeKey && VEHICLE_DB[makeKey] && VEHICLE_DB[makeKey].dtc_text && VEHICLE_DB[makeKey].dtc_text[base]) return VEHICLE_DB[makeKey].dtc_text[base];
  if (DTC_GENERIC[base]) return DTC_GENERIC[base];
  if (/^P03(0|1)\d$/.test(base) && +base.slice(3) > 0) return 'Cylinder ' + (+base.slice(3)) + ' misfire detected';
  const s = base[0], d1 = base[1], d2 = base[2];
  if (s === 'P') {
    if (d1 === '1' || d1 === '3') return 'Manufacturer-specific powertrain code';
    return ({ 1: 'Fuel/air metering', 2: 'Fuel/air metering (injectors)', 3: 'Ignition or misfire', 4: 'Emission controls',
      5: 'Speed, idle control or input circuit', 6: 'Computer or output circuit', 7: 'Transmission', 8: 'Transmission', 9: 'Transmission' })[d2] || 'Powertrain';
  }
  return ({ C: 'Chassis (ABS/suspension) code', B: 'Body (airbag/comfort) code', U: 'Network/communication code' })[s] || '';
}

// ---------------------------------------------------------------- all-systems engine
class AllSystems {
  constructor(elm) { this.elm = elm; }

  static parseUDS(m) {
    const out = [];
    for (let i = 3; i + 3 < m.length; i += 4) {
      const st = m[i + 3];
      if ((m[i] | m[i + 1] | m[i + 2]) === 0 || !(st & 0xAD)) continue;
      let c = decodeDTC(m[i], m[i + 1]);
      if (m[i + 2]) c += '-' + h2(m[i + 2]);
      if (!out.some((d) => d.code === c)) out.push({ code: c, status: st });
    }
    return out;
  }
  static parseCounted(m) {
    const out = [];
    if (m.length < 2 || !m[1]) return out;
    const n = m[1], rest = m.length - 2;
    let stride = 2;
    if (m[0] === 0x58) stride = 3;
    if (m[0] === 0x53 && rest === 3 * n) stride = 3;
    for (let k = 0, i = 2; k < n && i + 1 < m.length; k++, i += stride) {
      if (m[i] === 0 && m[i + 1] === 0) continue;
      const c = decodeDTC(m[i], m[i + 1]);
      if (!out.some((d) => d.code === c)) out.push({ code: c, status: stride === 3 && i + 2 < m.length ? m[i + 2] : 0x08 });
    }
    return out;
  }
  static tag(svc, st) {
    if (svc !== 'uds') return 'Stored';
    if (st & 0x01) return 'Active';
    if (st & 0x08) return 'Stored';
    if (st & 0x04) return 'Pending';
    return 'History';
  }

  async readCodes(mod, r) {
    const e = this.elm;
    r.dtcs = []; r.readOk = false; r.svc = null;
    if (!(await e.modSelect(mod.tx, mod.ext))) return false;
    let x = null;
    if (mod.proto.includes('uds') && (x = await e.enhRequest('1902FF')).r === 'pos') { r.dtcs = AllSystems.parseUDS(x.msg); r.svc = 'uds'; }
    else if (mod.proto.includes('kwp') && (x = await e.enhRequest('1800FF00')).r === 'pos') { r.dtcs = AllSystems.parseCounted(x.msg); r.svc = 'kwp'; }
    else if (mod.proto.includes('kwp') && (x = await e.enhRequest('13')).r === 'pos') { r.dtcs = AllSystems.parseCounted(x.msg); r.svc = 'kwp'; }
    else if ((x = await e.enhRequest('03')).r === 'pos') { r.dtcs = e.isCAN() ? AllSystems.parseCounted(x.msg) : []; r.svc = 'obd'; }
    else { r.note = x && x.r === 'neg' ? nrcText(x.nrc) : 'Answered, but codes not readable'; return false; }
    r.readOk = true;
    return true;
  }

  async scanModule(mod) {
    const e = this.elm;
    const r = { mod, present: false, readOk: false, svc: null, dtcs: [], note: '' };
    if (!(await e.modSelect(mod.tx, mod.ext))) {
      r.note = mod.ext >= 0 && !e.ceaOk ? 'Adapter can’t reach this module' : 'Not reachable';
      return r;
    }
    if (mod.proto.includes('uds') && (await e.enhRequest('3E00', 1500)).r !== 'none') r.present = true;
    else if ((mod.proto.includes('kwp') || mod.proto.includes('obd')) && (await e.enhRequest('3E', 1500)).r !== 'none') r.present = true;
    else if (mod.proto.includes('obd') && (await e.enhRequest('0100', 1500)).r === 'pos') r.present = true;
    if (r.present) await this.readCodes(mod, r);
    return r;
  }

  async clear(mod, svc) {
    const e = this.elm;
    if (!(await e.modSelect(mod.tx, mod.ext))) return { ok: false, msg: 'Module not reachable' };
    let x;
    if (svc === 'uds') x = await e.enhRequest('14FFFFFF', 5000);
    else if (svc === 'kwp') { x = await e.enhRequest('14FF00', 5000); if (x.r === 'neg' && x.nrc === 0x13) x = await e.enhRequest('14FFFFFF', 5000); }
    else if (svc === 'obd') x = await e.enhRequest('04', 5000);
    else return { ok: false, msg: 'Read codes first' };
    if (x.r === 'pos') return { ok: true, msg: 'Codes cleared' };
    return { ok: false, msg: x.r === 'neg' ? nrcText(x.nrc) : 'No reply from module' };
  }

  // manufacturer live value; returns metric (°C for temperatures)
  async readLive(p) {
    const e = this.elm;
    if (!(await e.modSelect(parseInt(p.tx, 16), -1))) return null;
    const x = await e.enhRequest(p.req, 1500);
    if (x.r !== 'pos') return null;
    const b = x.msg, echo = p.req.length / 2;
    for (let i = 1; i < echo; i++) if (b[i] !== parseInt(p.req.slice(2 * i, 2 * i + 2), 16)) return null;
    if (b.length < echo + Math.max(p.bytes[0], p.bytes[1]) + 1) return null;
    const A = b[echo + p.bytes[0]], B = b[echo + p.bytes[1]], raw = A * 256 + B;
    let v;
    if (p.formula === 'atf_toyota_07') v = raw * 0.007 - 40;
    else if (p.formula === 'atf_toyota_16') v = A * 459 / 255 + B * 1.6 / 255 - 40;
    else if (p.formula === 'temp_a40') v = A - 40;
    else v = raw;
    if (p.unit === 'F') v = (v - 32) * 5 / 9;
    return v;
  }

  // What can this adapter do? Each item: {name, ok (true/false/null=skipped), detail}
  async adapterCheck(makeKey) {
    const e = this.elm, res = [];
    res.push({ name: 'Adapter responds', ok: !!e.id, detail: e.id || 'No answer' });
    res.push({ name: 'Chip', ok: true, detail: e.stn ? e.stn + ' (genuine STN)' : 'ELM327-compatible (likely a clone)' });
    res.push({ name: 'Vehicle connection', ok: e.connected, detail: e.connected ? e.protoDesc : 'Turn the ignition on, then reconnect' });
    if (!e.connected) return res;
    res.push({ name: 'Multi-frame replies (VIN)', ok: e.vin.length === 17, detail: e.vin || 'VIN not reported' });
    if (!e.isCAN()) { res.push({ name: 'Module access', ok: null, detail: 'Needs a CAN vehicle (most 2008+)' }); return res; }
    e.enhBegin();
    const sh = await e.atOK('ATSH7E0'), cra = await e.atOK('ATCRA7E8');
    res.push({ name: 'Custom headers (ATSH)', ok: sh, detail: sh ? 'Supported' : 'Not supported' });
    res.push({ name: 'Receive filter (ATCRA)', ok: cra, detail: cra ? 'Supported' : 'Not supported' });
    const fc = (await e.atOK('ATFCSH7E0')) && (await e.atOK('ATFCSD300000')) && (await e.atOK('ATFCSM1'));
    res.push({ name: 'Flow control setup', ok: fc, detail: fc ? 'Supported' : 'Not supported (multi-frame module replies may fail)' });
    const cea = await e.atOK('ATCEA40');
    if (cea) { e.extUsed = true; await e.atOK('ATCEA'); }
    res.push({ name: 'Extended addressing', ok: cea, detail: cea ? 'Supported (Toyota body modules)' : 'Not supported - body/gateway modules will be skipped' });
    e.selTx = 0; e.selExt = -1;
    let ecm = false;
    if (sh && cra && (await e.modSelect(0x7E0, -1))) {
      ecm = (await e.enhRequest('0100', 1500)).r === 'pos' || (await e.enhRequest('3E', 1500)).r !== 'none';
    }
    res.push({ name: 'Engine answers when addressed', ok: ecm, detail: ecm ? 'Direct module access works' : 'No reply - All Systems won’t work with this adapter' });
    if (ecm && makeKey) {
      const abs = modulesFor(makeKey).find((m) => /ABS/.test(m.name));
      if (abs) {
        const r = await this.scanModule(abs);
        res.push({ name: 'ABS module test', ok: r.present, detail: r.present ? (r.readOk ? 'Read ' + r.dtcs.length + ' code(s)' : r.note) : 'No reply at ' + abs.tx.toString(16).toUpperCase() });
      }
    }
    await e.enhEnd();
    return res;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Elm, AllSystems, BleTransport, NativeTransport, SerialBase, toMessages, decodeDTC, makeFromVIN, modelYear, modulesFor, dtcText, PID_DEC };
}
