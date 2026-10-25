import Charts
import SwiftUI

struct ChannelDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let channel: Channel

    @AppStorage("chartMetric") private var metricRaw = Metric.subs.rawValue
    @AppStorage("chartRangeDays") private var rangeDays = 7.0

    var body: some View {
        let c = model.state?.channels[channel.id] ?? channel
        Screen(title: c.title) {
            Header(channel: c, config: model.config) { if let u = c.youtubeURL { openURL(u) } }
            StatsGrid(channel: c)
            ChartPanel(channel: c, metric: Metric(rawValue: metricRaw) ?? .subs, rangeDays: rangeDays,
                       setMetric: { metricRaw = $0.rawValue }, setRange: { rangeDays = $0 })
            VideosPanel(channel: c, cooldownHours: model.cooldownHours)
            let events = (model.state?.events ?? []).filter { $0.channelId == c.id }.prefix(10)
            if !events.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text(L("Olaylar", "Activity")).label().padding(.bottom, 6)
                    ForEach(Array(events)) { EventRow(event: $0) }
                }
                .panel()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh(force: true) }
    }
}

private struct Header: View {
    let channel: Channel
    let config: AppConfig?
    let open: () -> Void

    var body: some View {
        let d24 = channel.gain(.subs, over: 86400)?.delta ?? 0
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Avatar(url: channel.thumbURL, size: 48, title: channel.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text(channel.title).font(.headline).foregroundStyle(Theme.text)
                    if let h = channel.handle { Text(h).font(.caption).foregroundStyle(Theme.muted) }
                }
                Spacer()
                Button(action: open) {
                    Image(systemName: "arrow.up.right").font(.system(size: 15, weight: .bold))
                        .frame(width: 36, height: 36)
                        .background(Theme.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .accessibilityLabel(L("YouTube'da aç", "Open in YouTube"))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.number(channel.subs))
                    .font(.system(size: 60, weight: .heavy).monospacedDigit())
                    .foregroundStyle(Theme.text).lineLimit(1).minimumScaleFactor(0.5)
                HStack(spacing: 6) {
                    Text(L("ABONE", "SUBSCRIBERS")).label()
                    Text(L("\(Fmt.signed(d24)) son 24 saat", "\(Fmt.signed(d24)) last 24h")).font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(Theme.trend(d24))
                }
            }
            if let subs = channel.subs, let goal = config?.nextMilestone(after: subs) {
                GoalBlock(channel: channel, subs: subs, prev: goal.prev, next: goal.next)
            }
        }
        .panel()
    }
}

private struct GoalBlock: View {
    let channel: Channel
    let subs: Int
    let prev: Int
    let next: Int

    var body: some View {
        let perDay: Double? = {
            guard let g = channel.gain(.subs, over: 7 * 86400), g.hours >= 12, g.delta > 0 else { return nil }
            return Double(g.delta) / (g.hours / 24)
        }()
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(next == 1000 ? L("Hedef · 1.000 · YPP", "Goal · 1,000 · YPP") : L("Hedef · \(Fmt.number(next))", "Goal · \(Fmt.number(next))")).label()
                Spacer()
                Text(L("\(Fmt.number(next - subs)) kaldı", "\(Fmt.number(next - subs)) to go")).font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(Theme.text)
            }
            GoalBar(subs: subs, prev: prev, next: next, height: 6)
            if let perDay {
                let days = Int((Double(next - subs) / perDay).rounded(.up))
                Text(L("Bu hızla ~\(days) gün", "~\(days) days at this pace")).font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}

private struct StatsGrid: View {
    let channel: Channel

    var body: some View {
        let v24 = channel.gain(.views, over: 86400)?.delta ?? 0
        let s7 = channel.gain(.subs, over: 7 * 86400)?.delta ?? 0
        let perHour: Int? = {
            guard let g = channel.gain(.views, over: 3600), g.hours >= 0.25 else { return nil }
            return Int(Double(g.delta) / g.hours)
        }()
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                Stat(title: L("Toplam izlenme", "Total views"), value: Fmt.compact(channel.views)).panel(padding: 14)
                Stat(title: L("İzlenme · 24s", "Views · 24h"), value: Fmt.signed(v24), color: Theme.trend(v24)).panel(padding: 14)
            }
            GridRow {
                Stat(title: L("İzlenme / saat", "Views / hour"), value: perHour.map { Fmt.compact($0) } ?? "—").panel(padding: 14)
                Stat(title: L("Abone · 7g", "Subs · 7d"), value: Fmt.signed(s7), color: Theme.trend(s7)).panel(padding: 14)
            }
        }
    }
}

private struct ChartPanel: View {
    let channel: Channel
    let metric: Metric
    let rangeDays: Double
    let setMetric: (Metric) -> Void
    let setRange: (Double) -> Void
    @State private var selected: Date?

    private struct Point: Identifiable {
        let date: Date
        let value: Double
        var id: Date { date }
    }

    var body: some View {
        let lastT = channel.hist.last?[0] ?? 0
        let points = channel.hist
            .filter { $0[0] >= lastT - rangeDays * 86_400_000 && $0.count > metric.rawValue }
            .map { Point(date: Date(timeIntervalSince1970: $0[0] / 1000), value: $0[metric.rawValue]) }
        let lo = points.map(\.value).min() ?? 0
        let hi = points.map(\.value).max() ?? 1
        let pad = max((hi - lo) * 0.1, 1)
        let sel = selected.flatMap { d in points.min(by: { abs($0.date.timeIntervalSince(d)) < abs($1.date.timeIntervalSince(d)) }) }

        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Segmented(options: [(L("Abone", "Subs"), Metric.subs), (L("İzlenme", "Views"), Metric.views)], selection: metric, onSelect: setMetric)
                Spacer()
                Segmented(options: [(L("24S", "24H"), 1.0), (L("7G", "7D"), 7.0), (L("30G", "30D"), 30.0)], selection: rangeDays, onSelect: setRange)
            }
            HStack {
                if let sel {
                    Text(Fmt.number(Int(sel.value))).font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(Theme.text)
                    Text(sel.date.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(Lang.locale)))
                        .font(.caption).foregroundStyle(Theme.muted)
                } else if let first = points.first, let last = points.last {
                    let d = Int(last.value - first.value)
                    Text(Fmt.signed(d)).font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(Theme.trend(d))
                    Text(L("bu aralıkta", "in this range")).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .frame(height: 18)

            if points.count < 2 {
                Text(L("Grafik için veri birikiyor. Her 10 dakikada bir yeni nokta ekleniyor.", "Collecting data for the chart. A new point is added every 10 minutes."))
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                Chart(points) { p in
                    LineMark(x: .value("Zaman", p.date), y: .value("Değer", p.value))
                        .foregroundStyle(Theme.accent)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    if let sel, sel.date == p.date {
                        RuleMark(x: .value("Seçili", sel.date)).foregroundStyle(Theme.line)
                        PointMark(x: .value("Zaman", p.date), y: .value("Değer", p.value)).foregroundStyle(Theme.text).symbolSize(40)
                    }
                }
                .chartYScale(domain: (lo - pad)...(hi + pad))
                .chartXSelection(value: $selected)
                .chartYAxis {
                    AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { v in
                        AxisGridLine().foregroundStyle(Theme.line)
                        AxisValueLabel {
                            Text(Fmt.compact(Int(v.as(Double.self) ?? 0))).font(.caption2).foregroundStyle(Theme.muted)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisValueLabel(format: rangeDays <= 1 ? .dateTime.hour().minute() : .dateTime.day().month(.abbreviated))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .frame(height: 180)
            }
        }
        .panel()
    }
}

struct Segmented<T: Equatable>: View {
    let options: [(String, T)]
    let selection: T
    let onSelect: (T) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { i in
                let value = options[i].1
                Button { onSelect(value) } label: {
                    Text(options[i].0)
                        .font(.system(size: 11, weight: .bold)).tracking(0.6)
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .foregroundStyle(value == selection ? Theme.bg : Theme.muted)
                        .background(value == selection ? Theme.text : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .overlay(Rectangle().stroke(Theme.line, lineWidth: 1))
    }
}

private struct VideosPanel: View {
    @Environment(\.openURL) private var openURL
    let channel: Channel
    let cooldownHours: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L("Son videolar", "Latest videos")).label()
                Spacer()
                Text(L("\(Fmt.number(channel.videoCount)) video", "\(Fmt.number(channel.videoCount)) videos")).font(.caption2).foregroundStyle(Theme.muted)
            }
            let videos = channel.latestVideos
            if videos.isEmpty {
                Text(L("Henüz video yok.", "No videos yet.")).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(videos) { v in
                Button { if let u = v.watchURL { openURL(u) } } label: {
                    VideoRow(video: v, spiking: v.isSpiking(cooldownHours: cooldownHours))
                }
                .buttonStyle(.plain)
            }
        }
        .panel()
    }
}

private struct VideoRow: View {
    let video: Video
    let spiking: Bool

    var body: some View {
        let d24 = History.gain(video.hist, index: 1, over: 86400)?.delta
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                AsyncImage(url: video.thumbURL) { $0.resizable().scaledToFill() } placeholder: {
                    ZStack {
                        Rectangle().fill(Theme.surface2)
                        Image(systemName: "play.fill").font(.system(size: 16)).foregroundStyle(Theme.muted)
                    }
                }
                    .frame(width: 112, height: 63)
                    .clipped()
                if let d = Fmt.duration(video.duration) {
                    Text(d).font(.system(size: 10, weight: .bold).monospacedDigit())
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Color.black.opacity(0.85)).foregroundStyle(.white)
                        .padding(3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))

            VStack(alignment: .leading, spacing: 4) {
                Text(video.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                    .lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: 8) {
                    Text(L("\(Fmt.compact(video.views)) izl.", "\(Fmt.compact(video.views)) views"))
                    if let r = video.viewsPerHour { Text(L("\(Fmt.compact(Int(r)))/sa", "\(Fmt.compact(Int(r)))/h")) }
                    if let d24, d24 != 0 { Text(L("\(Fmt.signed(d24)) 24s", "\(Fmt.signed(d24)) 24h")).foregroundStyle(Theme.trend(d24)) }
                }
                .font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                HStack(spacing: 6) {
                    if spiking { Tag(text: L("Sıçrama", "Spike"), color: Theme.text) }
                    if video.live == "live" { Tag(text: L("Canlı", "Live"), color: Theme.text) }
                    Text(Fmt.ago(video.publishedDate)).font(.caption2).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

struct Tag: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased(with: Lang.locale)).font(.system(size: 9, weight: .heavy)).tracking(0.8)
            .padding(.horizontal, 5).padding(.vertical, 2)
            .foregroundStyle(Theme.bg).background(color)
    }
}
