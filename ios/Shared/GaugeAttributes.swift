import ActivityKit
import Foundation

/// The Live Activity shown on the CarPlay Dashboard and the Lock Screen: up to four gauges plus an optional warning.
/// Shared by the app (which starts and updates it) and the ScannerGauges widget extension (which draws it).
struct GaugeAttributes: ActivityAttributes {
    struct Item: Codable, Hashable {
        var label: String
        var value: String
        var unit: String
        /// 0 normal, 1 caution (orange), 2 warning (red)
        var level: Int
    }

    struct ContentState: Codable, Hashable {
        var items: [Item]
        var alert: String
    }

    var vehicle: String
}
