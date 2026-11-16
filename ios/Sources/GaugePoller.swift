import Foundation

/// Reads the chosen gauges straight from the adapter while the app is in the background (phone locked, CarPlay
/// showing), because the page's JavaScript is paused then. Same math as app.js; results go to the Live Activity.
final class GaugePoller {
    /// Sends a raw command to the adapter (bypasses the page).
    var send: ((String) -> Void)?

    private(set) var running = false
    private var cfg: [String: Any] = [:]
    private var buf = ""
    private var queue: [String] = []
    private var current: String?
    private var timeout: DispatchWorkItem?
    private var stopping: (([String: Double]) -> Void)?
    private var raw: [String: Double] = [:]      // metric values, keyed like app.js (rpm, speed, cool, ...)
    private var lastTick: Date?
    private var addMiles = 0.0, addGal = 0.0, addSecs = 0.0
    private var inst: Double?

    private static let galPerGramHour = 3600.0 / (14.7 * 2798.7)
    private static let pidFor: [String: String] = ["rpm": "0C", "speed": "0D", "cool": "05", "fuel": "2F", "iat": "0F",
                                                   "load": "04", "tps": "11", "oil": "5C", "maf": "10", "map": "0B"]

    func start(cfg: [String: Any]) {
        self.cfg = cfg
        guard !running else { return }
        running = true
        stopping = nil
        buf = ""; queue = []; raw = [:]
        addMiles = 0; addGal = 0; addSecs = 0; lastTick = nil; inst = nil
        next()
    }

    /// Finishes the command in flight, then reports what was driven while in the background.
    func stop(_ done: @escaping ([String: Double]) -> Void) {
        guard running else { done(["miles": 0, "gal": 0, "secs": 0]); return }
        if current == nil { finish(done) } else { stopping = done }
    }

    func cancel() {
        running = false; current = nil; stopping = nil
        timeout?.cancel()
    }

    func feed(_ text: String) {
        buf += text
        guard let r = buf.range(of: ">") else { return }
        let resp = String(buf[..<r.lowerBound])
        buf = String(buf[r.upperBound...])
        handle(resp)
    }

    // MARK: - Command cycle

    private func next() {
        guard running else { return }
        if let done = stopping { finish(done); return }
        if queue.isEmpty { publish(); queue = commands() }
        guard !queue.isEmpty else { return }
        let cmd = queue.removeFirst()
        current = cmd
        send?(cmd + "\r")
        let t = DispatchWorkItem { [weak self] in self?.handle(nil) }
        timeout = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: t)
    }

    private func handle(_ resp: String?) {
        timeout?.cancel()
        guard let cmd = current else { return }
        current = nil
        if let r = resp { parse(cmd, r) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in self?.next() }
    }

    private func finish(_ done: ([String: Double]) -> Void) {
        running = false; stopping = nil; current = nil
        timeout?.cancel()
        done(["miles": addMiles, "gal": addGal, "secs": addSecs])
    }

    private func commands() -> [String] {
        let keys = cfg["keys"] as? [String] ?? []
        var need: [String] = []
        func add(_ k: String) { if !need.contains(k) { need.append(k) } }
        for k in keys {
            switch k {
            case "tmpg", "impg", "cost":
                switch cfg["fuel"] as? String ?? "" {
                case "maf": add("maf"); add("speed")
                case "sd": add("map"); add("rpm"); add("iat"); add("speed")
                default: break
                }
            case "volt": add("volt")
            default: add(k)
            }
        }
        // the trip keeps counting even when no fuel gauge is shown
        if let f = cfg["fuel"] as? String, f == "maf" { add("maf"); add("speed") }
        return need.compactMap { k in
            if k == "volt" { return (cfg["voltPid"] as? Bool ?? false) ? "0142" : "ATRV" }
            return Self.pidFor[k].map { "01" + $0 }
        }
    }

    private func parse(_ cmd: String, _ resp: String) {
        if cmd == "ATRV" {
            let num = resp.filter { "0123456789.".contains($0) }
            if let v = Double(num), v > 5, v < 20 { raw["volt"] = v }
            return
        }
        let pid = String(cmd.dropFirst(2))
        let want = "41" + pid
        for line in resp.uppercased().components(separatedBy: CharacterSet(charactersIn: "\r\n")) {
            let s = line.replacingOccurrences(of: " ", with: "")
            guard let r = s.range(of: want) else { continue }
            let hex = String(s[r.upperBound...])
            var b: [Double] = []
            var i = hex.startIndex
            while hex.distance(from: i, to: hex.endIndex) >= 2 {
                let j = hex.index(i, offsetBy: 2)
                guard let v = UInt8(hex[i..<j], radix: 16) else { break }
                b.append(Double(v)); i = j
            }
            guard let a = b.first else { continue }
            let w = b.count > 1 ? a * 256 + b[1] : a
            switch pid {
            case "0C": raw["rpm"] = w / 4
            case "0D": raw["speed"] = a
            case "05": raw["cool"] = a - 40
            case "42": raw["volt"] = w / 1000
            case "2F": raw["fuel"] = a * 100 / 255
            case "0F": raw["iat"] = a - 40
            case "04": raw["load"] = a * 100 / 255
            case "11": raw["tps"] = a * 100 / 255
            case "5C": raw["oil"] = a - 40
            case "10": raw["maf"] = w / 100
            case "0B": raw["map"] = a
            default: break
            }
            return
        }
    }

    // MARK: - Trip math + card

    private func gph() -> Double? {
        if let maf = raw["maf"] { return maf * Self.galPerGramHour }
        if let map = raw["map"], let rpm = raw["rpm"], let iat = raw["iat"] {
            let disp = cfg["disp"] as? Double ?? 2.5
            let maf = (map * 1000) / (287.05 * (iat + 273.15)) * (disp / 1000) * (rpm / 120) * 0.85 * 1000
            return maf * Self.galPerGramHour
        }
        return nil
    }

    private func publish() {
        let now = Date()
        if let t = lastTick, let g = gph(), let kmh = raw["speed"] {
            let dt = min(5, now.timeIntervalSince(t))
            let mph = kmh / 1.609
            addMiles += mph * dt / 3600; addGal += g * dt / 3600; addSecs += dt
            inst = mph >= 2 ? min(99, mph / max(g, 0.05)) : nil
        }
        lastTick = now
        guard !raw.isEmpty else { return }
        let keys = cfg["keys"] as? [String] ?? []
        let labels = cfg["labels"] as? [String] ?? []
        let items = keys.enumerated().map { i, k in item(k, label: i < labels.count ? labels[i] : k) }
        LiveGauges.shared.update(vehicle: cfg["vehicle"] as? String ?? "Your vehicle",
                                 state: GaugeAttributes.ContentState(items: items, alert: alert()))
    }

    private func temp(_ c: Double) -> (String, String) {
        let f = cfg["tempF"] as? Bool ?? true
        return (String(Int((f ? c * 9 / 5 + 32 : c).rounded())), f ? "°F" : "°C")
    }

    private func item(_ k: String, label: String) -> GaugeAttributes.Item {
        var it = GaugeAttributes.Item(label: label, value: "—", unit: "", level: 0)
        let miles = (cfg["miles"] as? Double ?? 0) + addMiles, gal = (cfg["gal"] as? Double ?? 0) + addGal
        switch k {
        case "cool", "oil", "iat":
            if let c = raw[k] {
                (it.value, it.unit) = temp(c)
                if k != "iat" { it.level = c >= (k == "oil" ? 130 : 110) ? 2 : c >= (k == "oil" ? 120 : 104) ? 1 : 0 }
            }
        case "tmpg":
            it.unit = "mpg"
            if gal > 0.02 && miles > 0.1 { it.value = String(format: "%.1f", miles / gal) }
        case "impg":
            it.unit = "mpg"
            if let v = inst { it.value = String(format: "%.1f", v) }
        case "cost":
            it.value = String(format: "$%.2f", gal * (cfg["price"] as? Double ?? 3.25))
        case "volt":
            if let v = raw["volt"] { it.value = String(format: "%.1f", v); it.unit = "V"; it.level = v < 11.8 ? 2 : v < 12.2 ? 1 : 0 }
        case "speed":
            if let v = raw["speed"] {
                let mph = cfg["mph"] as? Bool ?? true
                it.value = String(Int((mph ? v / 1.609 : v).rounded())); it.unit = mph ? "mph" : "km/h"
            }
        case "rpm":
            if let v = raw["rpm"] { it.value = v >= 1000 ? String(format: "%d,%03d", Int(v) / 1000, Int(v) % 1000) : String(Int(v)) }
        default:
            if let v = raw[k] { it.value = String(Int(v.rounded())); it.unit = "%" }
        }
        return it
    }

    private func alert() -> String {
        if let c = raw["cool"], c >= 110 { return "Engine hot: " + temp(c).0 + temp(c).1 }
        if let v = raw["volt"] {
            if v < 11.8 { return String(format: "Battery low: %.1f V", v) }
            if let r = raw["rpm"], r > 500, v < 12.6 { return String(format: "Not charging: %.1f V", v) }
        }
        return ""
    }
}
