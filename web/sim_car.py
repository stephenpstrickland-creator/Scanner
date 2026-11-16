#!/usr/bin/env python3
"""ELM327/STN1110 + vehicle simulator for host-testing the scanner firmware.

Reads one command per line on stdin, writes the adapter's reply ending with '>'.
Emulates the ELM behaviour the firmware relies on: echo/spaces/headers flags,
ATSH/ATCP/ATCRA filtering, CAN extended addressing (ATCEA + ATTA), flow-control
setup (ATFCSH/ATFCSD/ATFCSM) for multi-frame replies, ISO-TP output format
("00A" length line + "0:" "1:" frames, padded), and "7F xx 78" response-pending.

usage: sim_car.py tacoma2007|honda [--elm 1.4b|1.3a]
"""
import sys

PAD = 0x55   # deliberately not 00, so padding bugs show up


def dtc(code):
    """'C0200' -> two bytes in SAE format."""
    sysbits = "PCBU".index(code[0]) << 14
    v = sysbits | int(code[1]) << 12 | int(code[2:], 16)
    return [v >> 8, v & 0xFF]


class Ecu:
    def __init__(self, tx, ext=None, handler=None):
        self.tx, self.ext, self.handler = tx, ext, handler
        if tx > 0x7FF:
            self.rx = (tx & 0xFFFF0000) | ((tx << 8) & 0xFF00) | ((tx >> 8) & 0xFF)
        else:
            self.rx = tx + 8


def sup(base, pids):
    m = 0
    for p in pids:
        m |= 1 << (31 - (p - base - 1))
    return "41%02X%08X" % (base, m)


def misrec(mid, cur, avg):
    r = [0x46]
    for tid, v in ((0x0B, avg), (0x0C, cur)):
        r += [mid, tid, 0x24, v >> 8, v & 0xFF, 0, 0, 0xFF, 0xFF]
    return bytes(r)


def tacoma2007():
    vin = b"5TETU62N37Z412345"
    st = {"abs": [dtc("C0200") + [0xE0], dtc("C1249") + [0xE0]],
          "eng": [dtc("P0441"), dtc("P0455"), dtc("P0504")],
          "body": [dtc("B2799") + [0x20], dtc("B1650") + [0x20]],
          "srs_first": True}

    def ecm(r):
        h = bytes(r).hex().upper()
        tbl = {"0100": sup(0x00, [1,3,4,5,6,7,8,9,0x0B,0x0C,0x0D,0x0E,0x0F,0x10,0x11,0x13,0x14,0x15,0x1C,0x1F,0x20]),
               "0120": sup(0x20, [0x21,0x2E,0x2F,0x30,0x31,0x33,0x3C,0x40]),
               "0140": sup(0x40, [0x41,0x42,0x43,0x44,0x45,0x47,0x49,0x4A,0x4C]),
               "07": "4700", "0A": "4A00", "010C": "410C0AF0", "0105": "41057B",
               "0101": "4101" + ("83" if st["eng"] else "00") + "07E504", "0104": "410436", "0106": "410681", "0107": "410786",
               "0108": "41087F", "0109": "410984", "010B": "410B21", "010D": "410D00", "010E": "410E54", "010F": "410F3A",
               "0110": "41100162", "0111": "411125", "0114": "41145A", "011F": "411F0384", "012F": "412F9E", "0133": "413365",
               "0142": "41423708", "06A0": "46A0FE000000",
               "020200": "42020004" + "41", "020C00": "420C001CC0", "020D00": "420D0026", "020500": "42050082",
               "020400": "4204004F", "020600": "42060083", "020700": "42070086",
               "3E": "7E", "3E00": "7F3E12", "1902FF": "7F1911", "1800FF00": "7F1811", "13": "7F1311",
               "2182": "7F2112", "21D9": "61D9" + "0000" + "0000" + "77FA" + "6F9B" + "0000"}
        if h in tbl:
            return [bytes.fromhex(tbl[h])]
        if h == "0902":
            return [bytes([0x49, 0x02, 0x01]) + vin]
        if h.startswith("06A") and len(h) == 4 and h != "06A0":
            mid = int(h[2:], 16)
            if 0xA2 <= mid <= 0xA7:
                cyl = mid - 0xA1
                return [misrec(mid, 5 if cyl == 3 else (1 if cyl == 5 else 0), 6 if cyl == 3 else (2 if cyl == 5 else 0))]
        if h == "03":
            return [bytes([0x43, len(st["eng"])] + sum(st["eng"], []))]
        if h == "04":
            st["eng"] = []
            return [b"\x44"]
        return [bytes([0x7F, r[0], 0x11])]

    def abs_(r):                       # KWP2000-on-CAN skid control ECU
        h = bytes(r).hex().upper()
        if h == "3E":       return [b"\x7E"]
        if h == "3E00":     return [b"\x7F\x3E\x12"]
        if h == "1800FF00": return [bytes([0x58, len(st["abs"])] + sum(st["abs"], []))]
        if h == "13":       return [bytes([0x53, len(st["abs"])] + sum([d[:2] for d in st["abs"]], []))]
        if h == "14FF00":
            st["abs"] = []
            return [b"\x54\xFF\x00"]
        return [bytes([0x7F, r[0], 0x11])]

    def srs(r):                        # slow airbag ECU: answers "pending" first
        h = bytes(r).hex().upper()
        if h == "3E":   return [b"\x7E"]
        if h == "1800FF00":
            return [b"\x7F\x18\x78", b"\x58\x00"]
        if h == "14FF00": return [b"\x54\xFF\x00"]
        return [bytes([0x7F, r[0], 0x11])]

    def body(r):                       # main body ECU behind gateway 0x750, ext addr 0x40
        h = bytes(r).hex().upper()
        if h == "3E":       return [b"\x7E"]
        if h == "1800FF00": return [bytes([0x58, len(st["body"])] + sum(st["body"], []))]
        if h == "14FF00":   return [b"\x7F\x14\x22"]          # refuses: conditions not correct
        return [bytes([0x7F, r[0], 0x11])]

    return [Ecu(0x7E0, None, ecm), Ecu(0x7B0, None, abs_), Ecu(0x780, None, srs),
            Ecu(0x750, 0x40, body)], 6


def honda():
    vin = b"1HGCV1F30LA012345"
    st = {"vsa": [[0x50, 0x31, 0x13, 0x2F], [0x41, 0x22, 0x00, 0x08], [0x40, 0x10, 0x00, 0x50]]}

    def ecm(r):
        h = bytes(r).hex().upper()
        tbl = {"0100": "4100BE3FA813", "0120": "41200000000", "03": "4300", "07": "4700", "0A": "4A00",
               "3E00": "7E00"}
        if h == "0902": return [bytes([0x49, 0x02, 0x01]) + vin]
        if h in tbl and len(tbl[h]) % 2 == 0: return [bytes.fromhex(tbl[h])]
        return [bytes([0x7F, r[0], 0x11])]

    def vsa(r):                        # UDS on 29-bit CAN
        h = bytes(r).hex().upper()
        if h == "3E00":     return [b"\x7E\x00"]
        if h == "1902FF":   return [bytes([0x59, 0x02, 0xFF] + sum(st["vsa"], []))]
        if h == "14FFFFFF":
            st["vsa"] = []
            return [b"\x54"]
        return [bytes([0x7F, r[0], 0x11])]

    return [Ecu(0x7E0, None, ecm), Ecu(0x18DA28F1, None, vsa)], 6


class Elm:
    def __init__(self, ecus, proto, ver):
        self.ecus, self.car_proto, self.ver = ecus, proto, ver
        self.reset()

    def reset(self):
        self.echo, self.spaces, self.headers = True, True, False
        self.proto, self.cur = 0, None
        self.sh, self.cp, self.cra, self.cea, self.ta = None, 0x18, None, None, 0xF1
        self.fcsm, self.fcsh, self.fcsd = 0, None, None

    def fmt(self, data):
        s = data.hex().upper()
        return " ".join(s[i:i + 2] for i in range(0, len(s), 2)) if self.spaces else s

    def at(self, c):
        v14 = self.ver >= "1.4"
        if c == "Z":   self.reset(); return "\r\rELM327 v" + self.ver
        if c == "I":   return "ELM327 v" + self.ver
        if c in ("E0", "E1"): self.echo = c == "E1"; return "OK"
        if c in ("S0", "S1"): self.spaces = c == "S1"; return "OK"
        if c in ("H0", "H1"): self.headers = c == "H1"; return "OK"
        if c in ("L0", "L1", "AT1", "AT0", "AT2"): return "OK"
        if c == "RV":  return "12.6V"
        if c.startswith("SP"):
            self.proto = int(c[2:], 16)
            self.cur = None if self.proto == 0 else self.proto
            return "OK"
        if c == "DPN": return ("A" if self.proto == 0 else "") + "%X" % (self.cur or 0)
        if c == "DP":
            return {6: "ISO 15765-4 (CAN 11/500)", 7: "ISO 15765-4 (CAN 29/500)"}.get(self.cur, "AUTO")
        if c.startswith("SH"):
            self.sh = c[2:]; return "OK" if len(self.sh) in (3, 6) else "?"
        if c.startswith("CP"): self.cp = int(c[2:], 16); return "OK"
        if c == "CRA":   self.cra = None; return "OK" if v14 else "?"
        if c == "AR":    self.cra = None; return "OK"
        if c.startswith("CRA"): self.cra = int(c[3:], 16); return "OK"
        if c.startswith("CEA"):
            if not v14: return "?"
            self.cea = int(c[3:], 16) if len(c) > 3 else None; return "OK"
        if c.startswith("TA"): self.ta = int(c[2:], 16); return "OK"
        if c.startswith("FCSH"): self.fcsh = int(c[4:], 16); return "OK"
        if c.startswith("FCSD"): self.fcsd = bytes.fromhex(c[4:]); return "OK"
        if c.startswith("FCSM"): self.fcsm = int(c[4:]); return "OK"
        return "?"

    def tx_id(self):
        is29 = self.cur in (7, 9)
        if self.sh is None:
            return 0x18DB33F1 if is29 else 0x7DF
        if len(self.sh) == 6:
            return (self.cp << 24) | int(self.sh, 16) if is29 else int(self.sh[-3:], 16)
        return int(self.sh, 16) if not is29 else None

    def request(self, h):
        if len(h) % 2 == 1 and len(h) > 2:       # trailing "expected replies" digit, e.g. 010C1
            h = h[:-1]
        try:
            req = bytes.fromhex(h)
        except ValueError:
            return "?"
        out_lines = []
        if self.cur is None:                      # auto search
            self.cur = self.car_proto
            out_lines.append("SEARCHING...")
        if self.cur != self.car_proto and not (self.car_proto == 6 and self.cur == 7):
            return "\r".join(out_lines + ["UNABLE TO CONNECT"])
        tid = self.tx_id()
        replies = []
        for e in self.ecus:
            if tid is None: break
            if (e.tx > 0x7FF) != (self.cur in (7, 9)): continue
            functional = tid in (0x7DF, 0x18DB33F1)
            if functional:
                if e.tx != 0x7E0 or req[0] > 0x0A or self.cea is not None: continue
            elif tid != e.tx or e.ext != self.cea:
                continue
            for r in e.handler(list(req)):
                replies.append((e, r))
        lines = []
        for e, r in replies:
            if self.cra is not None and e.rx != self.cra: continue
            if e.ext is not None and self.ta != e.ext: continue     # ELM drops frames for another tester
            room_sf = 7 - (1 if e.ext is not None else 0)
            if len(r) <= room_sf:
                lines.append(self.fmt(r))
                continue
            # multi-frame: the ECU waits for a correct flow-control frame
            if self.fcsm == 1:
                fc_id, fc_data = self.fcsh, self.fcsd or b""
            else:
                fc_id = (e.rx - 8) if e.rx <= 0x7FF else e.tx
                fc_data = b"\x30\x00\x00"
            want = (bytes([e.ext]) if e.ext is not None else b"") + b"\x30"
            if fc_id != e.tx or not fc_data.startswith(want):
                continue                                        # ECU gives up -> nothing more
            lines.append("%03X" % len(r))
            first, rest = room_sf - 1, room_sf
            chunks = [r[:first]] + [r[i:i + rest] for i in range(first, len(r), rest)]
            for i, ch in enumerate(chunks):
                if i: ch = ch + bytes([PAD]) * (rest - len(ch))
                lines.append("%X:%s" % (i & 0xF, (" " if self.spaces else "") + self.fmt(ch)))
        if not lines:
            lines = ["NO DATA"]
        return "\r".join(out_lines + lines)

    def handle(self, cmd):
        c = cmd.strip().upper().replace(" ", "")
        body = self.at(c[2:]) if c.startswith("AT") else self.request(c)
        return (cmd + "\r" if self.echo else "") + body + "\r\r>"


def main():
    car = sys.argv[1] if len(sys.argv) > 1 else "tacoma2007"
    ver = sys.argv[sys.argv.index("--elm") + 1] if "--elm" in sys.argv else "1.4b"
    ecus, proto = {"tacoma2007": tacoma2007, "honda": honda}[car]()
    elm = Elm(ecus, proto, ver)
    for line in sys.stdin:
        sys.stdout.write(elm.handle(line.rstrip("\r\n")))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
