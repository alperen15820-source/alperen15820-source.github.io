import SwiftUI
import WidgetKit

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let summary: Summary?
}

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), summary: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(ComplicationEntry(date: Date(), summary: SharedSettings.cachedSummary ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        Task {
            var summary = SharedSettings.cachedSummary
            if let api = APIClient(), let fresh = try? await api.summary() {
                summary = fresh
                SharedSettings.cachedSummary = fresh
            }
            completion(Timeline(entries: [ComplicationEntry(date: Date(), summary: summary)], policy: .after(Date().addingTimeInterval(30 * 60))))
        }
    }
}

@main
struct KanalTakipComplications: WidgetBundle {
    var body: some Widget {
        SubsComplication()
    }
}

struct SubsComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KanalTakipWatchSubs", provider: ComplicationProvider()) { entry in
            ComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Kanal Takip")
        .description(L("Son 24 saatteki abone artışı.", "Subscriber change over the last 24 hours."))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ComplicationEntry

    var body: some View {
        let s = entry.summary
        let subs = s.map { Fmt.signed($0.totalSubsDelta) } ?? "—"
        switch family {
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text(subs).font(.system(size: 14, weight: .heavy).monospacedDigit()).minimumScaleFactor(0.5)
                Text(L("ABONE", "SUBS")).font(.system(size: 8, weight: .bold))
            }
            .widgetAccentable()
        case .accessoryCorner:
            Text(subs).font(.system(size: 14, weight: .heavy).monospacedDigit())
                .widgetLabel(L("abone · 24s", "subs · 24h"))
        case .accessoryInline:
            Text(L("\(subs) abone · 24s", "\(subs) subs · 24h"))
        default:
            VStack(alignment: .leading, spacing: 1) {
                Text(L("KANAL TAKİP · 24S", "KANAL TAKİP · 24H")).font(.system(size: 11, weight: .bold)).widgetAccentable()
                Text(L("\(subs) abone", "\(subs) subs")).font(.system(size: 16, weight: .heavy).monospacedDigit())
                Text(L("\(s.map { Fmt.signed($0.totalViewsDelta) } ?? "—") izlenme", "\(s.map { Fmt.signed($0.totalViewsDelta) } ?? "—") views"))
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
