import ActivityKit
import SwiftUI
import WidgetKit

@main
struct GaugesBundle: WidgetBundle {
    var body: some Widget {
        GaugeLiveActivity()
    }
}

/// Live gauges: Lock Screen / StandBy (medium), CarPlay Dashboard and Apple Watch Smart Stack (small), Dynamic Island.
struct GaugeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GaugeAttributes.self) { context in
            GaugeCard(context: context)
                .activityBackgroundTint(Color.black.opacity(0.82))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let items = context.state.items
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { GaugeCell(item: items[safe: 0], size: 26) }
                DynamicIslandExpandedRegion(.trailing) { GaugeCell(item: items[safe: 1], size: 26) }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        HStack {
                            GaugeCell(item: items[safe: 2], size: 22)
                            Spacer()
                            GaugeCell(item: items[safe: 3], size: 22)
                        }
                        if !context.state.alert.isEmpty { AlertLine(text: context.state.alert) }
                    }
                }
            } compactLeading: {
                CompactValue(item: items[safe: 0])
            } compactTrailing: {
                CompactValue(item: items[safe: 1])
            } minimal: {
                CompactValue(item: items[safe: 0])
            }
        }
        .supplementalActivityFamilies([.small, .medium])
    }
}

struct GaugeCard: View {
    let context: ActivityViewContext<GaugeAttributes>
    @Environment(\.activityFamily) private var family

    var body: some View {
        let items = context.state.items
        if family == .small {
            // CarPlay Dashboard / Watch: a 2 x 2 grid of big numbers, nothing else
            VStack(alignment: .leading, spacing: 4) {
                if !context.state.alert.isEmpty {
                    AlertLine(text: context.state.alert)
                } else {
                    HStack(spacing: 8) {
                        GaugeCell(item: items[safe: 0], size: 20)
                        Spacer(minLength: 0)
                        GaugeCell(item: items[safe: 1], size: 20)
                    }
                }
                HStack(spacing: 8) {
                    GaugeCell(item: items[safe: 2], size: 20)
                    Spacer(minLength: 0)
                    GaugeCell(item: items[safe: 3], size: 20)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "car.side.fill").foregroundStyle(.secondary)
                    Text(context.attributes.vehicle).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if !context.state.alert.isEmpty { AlertLine(text: context.state.alert) }
                }
                HStack(alignment: .top) {
                    ForEach(0..<4, id: \.self) { i in
                        GaugeCell(item: items[safe: i], size: 28)
                        if i < 3 { Spacer(minLength: 4) }
                    }
                }
            }
            .padding(16)
        }
    }
}

struct GaugeCell: View {
    let item: GaugeAttributes.Item?
    let size: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text((item?.label ?? "").uppercased())
                .font(.system(size: max(9, size * 0.38), weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(item?.value ?? "—")
                    .font(.system(size: size, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(levelColor(item?.level ?? 0))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let u = item?.unit, !u.isEmpty {
                    Text(u).font(.system(size: max(9, size * 0.42), weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
    }
}

struct CompactValue: View {
    let item: GaugeAttributes.Item?
    var body: some View {
        Text(item?.value ?? "—")
            .font(.system(size: 15, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(levelColor(item?.level ?? 0))
    }
}

struct AlertLine: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(.red)
            .lineLimit(1)
    }
}

func levelColor(_ level: Int) -> Color {
    switch level {
    case 2: return .red
    case 1: return .orange
    default: return .primary
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
