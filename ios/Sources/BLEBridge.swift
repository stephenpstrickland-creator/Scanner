import UIKit
import WebKit
import CoreBluetooth

/// CoreBluetooth side of the scanner: finds the OBD adapter, opens its
/// serial-over-BLE service and passes text both ways to the page
/// (window.__nativeBle in core.js).
final class BLEBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private weak var webView: WKWebView?
    private weak var presenter: UIViewController?
    private var central: CBCentralManager?
    private var found: [UUID: (peripheral: CBPeripheral, name: String, rssi: Int)] = [:]
    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var tx: CBCharacteristic?
    private var wantConnect = false
    private var scanning = false
    private var pendingServices = 0
    private var connectName = ""

    // Serial services used by ELM327-style adapters (OBDLink CX and most clones use FFF0).
    private let preferred: [CBUUID] = ["FFF0", "FFE0", "18F0", "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2", "BEEF"].map { CBUUID(string: $0) }

    init(webView: WKWebView, presenter: UIViewController) {
        self.webView = webView
        self.presenter = presenter
        super.init()
    }

    // MARK: - Commands from the page

    func connect() {
        wantConnect = true
        guard let c = central else {
            // Created on first use so the Bluetooth permission prompt appears when it's needed.
            central = CBCentralManager(delegate: self, queue: .main)
            return
        }
        handleState(c.state)
    }

    func write(_ text: String) {
        guard let p = peripheral, let t = tx else { return }
        let bytes = Array(text.utf8)
        let type: CBCharacteristicWriteType = t.properties.contains(.write) ? .withResponse : .withoutResponse
        var i = 0
        while i < bytes.count {
            let end = min(i + 20, bytes.count)            // 20 bytes fits every BLE MTU
            p.writeValue(Data(bytes[i..<end]), for: t, type: type)
            i = end
        }
    }

    func disconnect() {
        wantConnect = false
        if scanning { central?.stopScan(); scanning = false }
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        peripheral = nil; rx = nil; tx = nil
    }

    // MARK: - Central

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if wantConnect { handleState(central.state) }
        if central.state != .poweredOn, tx != nil {
            peripheral = nil; rx = nil; tx = nil
            js("onDisconnect", "")
        }
    }

    private func handleState(_ state: CBManagerState) {
        switch state {
        case .poweredOn: startScan()
        case .poweredOff: fail("Bluetooth is off. Turn it on in Control Center, then try again.")
        case .unauthorized: fail("Bluetooth permission is off. Turn it on in Settings > Scanner > Bluetooth.")
        case .unsupported: fail("This device doesn't support Bluetooth LE.")
        default: break   // .unknown / .resetting: wait for the next update
        }
    }

    private func startScan() {
        guard let c = central, !scanning else { return }
        if let p = peripheral { c.cancelPeripheralConnection(p) }
        peripheral = nil; rx = nil; tx = nil
        found.removeAll()
        scanning = true
        js("onStatus", "Looking for adapters...")
        c.scanForPeripherals(withServices: nil, options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self] in self?.finishScan() }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
        guard let n = name, !n.isEmpty else { return }
        found[peripheral.identifier] = (peripheral: peripheral, name: n, rssi: RSSI.intValue)
    }

    private func finishScan() {
        guard scanning else { return }
        central?.stopScan()
        scanning = false
        guard wantConnect else { return }
        let list = found.values.sorted { $0.rssi > $1.rssi }
        guard !list.isEmpty else {
            fail("No Bluetooth adapters found. Check the adapter is plugged in, the key is on, and other OBD apps are closed.")
            return
        }
        let sheet = UIAlertController(title: "Choose your adapter",
                                      message: "OBD adapters are often named OBDII, V-LINK, Vgate, OBDLink or a short code like V011.",
                                      preferredStyle: .actionSheet)
        for item in list.prefix(12) {
            sheet.addAction(UIAlertAction(title: item.name, style: .default) { [weak self] _ in
                self?.connectTo(item.peripheral, name: item.name)
            })
        }
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.wantConnect = false
            self?.js("onError", "cancel")
        })
        if let v = presenter?.view {
            sheet.popoverPresentationController?.sourceView = v
            sheet.popoverPresentationController?.sourceRect = CGRect(x: v.bounds.midX, y: v.bounds.midY, width: 1, height: 1)
        }
        presenter?.present(sheet, animated: true)
    }

    private func connectTo(_ p: CBPeripheral, name: String) {
        guard let c = central else { return }
        peripheral = p
        connectName = name
        p.delegate = self
        js("onStatus", "Connecting to \(name)...")
        c.connect(p, options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self = self, self.wantConnect, self.tx == nil, self.peripheral === p else { return }
            self.central?.cancelPeripheralConnection(p)
            self.fail("Couldn't connect to \(name). Unplug the adapter for a few seconds and try again.")
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        js("onStatus", "Opening the adapter...")
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        fail("Couldn't connect: \(error?.localizedDescription ?? "unknown error")")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let wasReady = tx != nil
        if self.peripheral === peripheral { self.peripheral = nil; rx = nil; tx = nil }
        if wasReady { js("onDisconnect", "") }
    }

    // MARK: - Peripheral

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services, !services.isEmpty else {
            fail("This adapter didn't list any services.")
            return
        }
        pendingServices = services.count
        for s in services { peripheral.discoverCharacteristics(nil, for: s) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        pendingServices -= 1
        if pendingServices > 0 { return }
        chooseSerial(peripheral)
    }

    private func chooseSerial(_ p: CBPeripheral) {
        let services = (p.services ?? []).sorted { a, b in
            (preferred.contains(a.uuid) ? 0 : 1) < (preferred.contains(b.uuid) ? 0 : 1)
        }
        var pick: (CBCharacteristic, CBCharacteristic)?
        for s in services {
            let chars = s.characteristics ?? []
            let r = chars.first { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
            let t = chars.first { $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse) }
            if let r = r, let t = t { pick = (r, t); break }
        }
        guard let chosen = pick else {
            fail("This adapter has no serial service I recognise.")
            return
        }
        rx = chosen.0
        tx = chosen.1
        p.setNotifyValue(true, for: chosen.0)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic == rx, wantConnect else { return }
        if let e = error {
            fail("Couldn't open the adapter: \(e.localizedDescription)")
            return
        }
        wantConnect = false
        js("onConnected", connectName)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic == rx, let data = characteristic.value, !data.isEmpty else { return }
        let text = String(data: data, encoding: .isoLatin1) ?? String(decoding: data, as: UTF8.self)
        js("onData", text)
    }

    // MARK: - Helpers

    private func fail(_ message: String) {
        wantConnect = false
        if scanning { central?.stopScan(); scanning = false }
        js("onError", message)
    }

    /// Calls window.__nativeBle.<fn>("<arg>") with the argument safely JSON-encoded.
    private func js(_ fn: String, _ arg: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [arg]),
              let wrapped = String(data: data, encoding: .utf8) else { return }
        let literal = String(wrapped.dropFirst().dropLast())   // ["text"] -> "text"
        webView?.evaluateJavaScript("if (window.__nativeBle) window.__nativeBle.\(fn)(\(literal));", completionHandler: nil)
    }
}
