import ActivityKit
import Foundation

/// Starts, updates and ends the gauges Live Activity (CarPlay Dashboard + Lock Screen).
final class LiveGauges {
    static let shared = LiveGauges()

    private var activity: Activity<GaugeAttributes>?
    private var vehicle = ""
    private var last: GaugeAttributes.ContentState?
    private var lastSent = Date.distantPast

    /// Removes cards left over from a previous run (e.g. the app was closed while connected).
    func endLeftovers() {
        for a in Activity<GaugeAttributes>.activities {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }

    func update(vehicle: String, state: GaugeAttributes.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let now = Date()
        if state == last && now.timeIntervalSince(lastSent) < 30 { return }   // nothing changed
        last = state
        lastSent = now
        let content = ActivityContent(state: state, staleDate: now.addingTimeInterval(120))
        if let a = activity, a.activityState == .active, vehicle == self.vehicle {
            Task { await a.update(content) }
            return
        }
        // A Live Activity can only be started while the app is on screen; updates work in the background.
        if let old = activity { Task { await old.end(nil, dismissalPolicy: .immediate) } }
        self.vehicle = vehicle
        activity = try? Activity.request(attributes: GaugeAttributes(vehicle: vehicle), content: content, pushType: nil)
    }

    func end() {
        last = nil
        guard let a = activity else { return }
        activity = nil
        Task { await a.end(nil, dismissalPolicy: .immediate) }
    }
}
