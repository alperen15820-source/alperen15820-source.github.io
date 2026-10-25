import SwiftUI
import WidgetKit

struct SummaryEntry: TimelineEntry {
    let date: Date
    let summary: Summary?
    var placeholder = false
}

struct SummaryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: Date(), summary: .sample, placeholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        completion(SummaryEntry(date: Date(), summary: SharedSettings.cachedSummary ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        Task {
            var summary = SharedSettings.cachedSummary
            if let api = APIClient(), let fresh = try? await api.summary() {
                summary = fresh
                SharedSettings.cachedSummary = fresh
            }
            let next = Date().addingTimeInterval(15 * 60)
            completion(Timeline(entries: [SummaryEntry(date: Date(), summary: summary)], policy: .after(next)))
        }
    }
}

@main
struct KanalTakipWidgets: WidgetBundle {
    var body: some Widget {
        SummaryWidget()
    }
}

struct SummaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KanalTakipSummary", provider: SummaryProvider()) { entry in
            SummaryWidgetView(entry: entry)
                .containerBackground(Theme.bg, for: .widget)
        }
        .configurationDisplayName("Kanal Takip")
        .description(L("Kanallarının son 24 saati.", "Your channels over the last 24 hours."))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

struct SummaryWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SummaryEntry

    var body: some View {
        if let s = entry.summary, !s.channels.isEmpty {
            switch family {
            case .accessoryInline:
                Text(L("\(Fmt.signed(s.totalSubsDelta)) abone · \(Fmt.signed(s.totalViewsDelta)) izl.", "\(Fmt.signed(s.totalSubsDelta)) subs · \(Fmt.signed(s.totalViewsDelta)) views"))
            case .accessoryCircular:
                VStack(spacing: 0) {
                    Text(Fmt.signed(s.totalSubsDelta)).font(.system(size: 15, weight: .heavy).monospacedDigit()).minimumScaleFactor(0.5)
                    Text(L("ABONE", "SUBS")).font(.system(size: 8, weight: .bold))
                }
                .widgetAccentable()
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("KANAL TAKİP · 24S", "KANAL TAKİP · 24H")).font(.system(size: 10, weight: .bold)).widgetAccentable()
                    Text(L("\(Fmt.signed(s.totalSubsDelta)) abone", "\(Fmt.signed(s.totalSubsDelta)) subs")).font(.system(size: 15, weight: .heavy).monospacedDigit())
                    Text(L("\(Fmt.signed(s.totalViewsDelta)) izlenme", "\(Fmt.signed(s.totalViewsDelta)) views")).font(.system(size: 12, weight: .semibold).monospacedDigit())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .systemSmall:
                SmallView(summary: s)
            default:
                ListView(summary: s, limit: family == .systemLarge ? 8 : 3)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("KANAL TAKİP").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
                Text(L("Kanal eklemek için uygulamayı aç.", "Open the app to add channels.")).font(.caption).foregroundStyle(Theme.text)
            }
        }
    }
}

private struct SmallView: View {
    let summary: Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L("TOPLAM ABONE", "TOTAL SUBSCRIBERS")).font(.system(size: 9, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
            Text(Fmt.compact(summary.totalSubs))
                .font(.system(size: 34, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.text)
                .minimumScaleFactor(0.5).lineLimit(1)
            Rectangle().fill(Theme.accent).frame(width: 24, height: 3)
            Spacer(minLength: 0)
            Text(L("\(Fmt.signed(summary.totalSubsDelta)) abone", "\(Fmt.signed(summary.totalSubsDelta)) subs")).font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.trend(summary.totalSubsDelta))
            Text(L("\(Fmt.signed(summary.totalViewsDelta)) izl.", "\(Fmt.signed(summary.totalViewsDelta)) views")).font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.trend(summary.totalViewsDelta))
            Text(L("son 24 saat", "last 24 hours")).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct ListView: View {
    let summary: Summary
    let limit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(L("KANAL TAKİP · 24S", "KANAL TAKİP · 24H")).font(.system(size: 9, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
                Spacer()
                Text(L("\(Fmt.signed(summary.totalSubsDelta)) abone", "\(Fmt.signed(summary.totalSubsDelta)) subs")).font(.system(size: 11, weight: .heavy).monospacedDigit())
                    .foregroundStyle(Theme.trend(summary.totalSubsDelta))
            }
            ForEach(summary.channels.prefix(limit)) { c in
                HStack(spacing: 8) {
                    Text(c.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(Fmt.compact(c.subs)).font(.system(size: 13, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.text)
                    Text(Fmt.signed(c.subsDelta)).font(.system(size: 11, weight: .bold).monospacedDigit())
                        .foregroundStyle(Theme.trend(c.subsDelta)).frame(minWidth: 34, alignment: .trailing)
                }
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            Spacer(minLength: 0)
        }
    }
}
