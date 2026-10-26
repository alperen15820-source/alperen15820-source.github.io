import SwiftUI

@main
struct KanalTakipWatchApp: App {
    @State private var model = WatchModel.shared
    @Environment(\.scenePhase) private var scenePhase

    init() { WatchModel.shared.start() }

    var body: some Scene {
        WindowGroup {
            WatchContentView()
                .environment(model)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.refresh() } }
                }
        }
    }
}

struct WatchContentView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        Group {
            if let s = model.summary, !s.channels.isEmpty {
                TabView {
                    TotalPage(summary: s)
                    ForEach(s.channels) { ChannelPage(channel: $0) }
                }
                .tabViewStyle(.verticalPage)
            } else {
                EmptyPage(message: model.error)
            }
        }
        .containerBackground(Theme.bg.gradient, for: .tabView)
        .task { await model.refresh() }
    }
}

private struct TotalPage: View {
    let summary: Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L("TOPLAM ABONE", "TOTAL SUBS")).font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
            Text(Fmt.compact(summary.totalSubs))
                .font(.system(size: 40, weight: .black).monospacedDigit())
                .foregroundStyle(Theme.text).minimumScaleFactor(0.5).lineLimit(1)
            Rectangle().fill(Theme.accent).frame(width: 24, height: 3)
            DeltaRow(label: L("Abone · 24s", "Subs · 24h"), value: summary.totalSubsDelta)
            DeltaRow(label: L("İzlenme · 24s", "Views · 24h"), value: summary.totalViewsDelta)
            Spacer(minLength: 0)
            Text(Fmt.ago(summary.updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) }))
                .font(.system(size: 11)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 4)
    }
}

private struct ChannelPage: View {
    let channel: Summary.Item

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(channel.title.uppercased(with: Lang.locale)).font(.system(size: 12, weight: .heavy)).tracking(0.5)
                .foregroundStyle(Theme.muted).lineLimit(1)
            Text(Fmt.number(channel.subs))
                .font(.system(size: 36, weight: .black).monospacedDigit())
                .foregroundStyle(Theme.text).minimumScaleFactor(0.5).lineLimit(1)
            DeltaRow(label: L("Abone · 24s", "Subs · 24h"), value: channel.subsDelta)
            DeltaRow(label: L("İzlenme · 24s", "Views · 24h"), value: channel.viewsDelta)
            if let subs = channel.subs, let next = channel.nextMilestone {
                VStack(alignment: .leading, spacing: 3) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(Theme.surface2)
                            Rectangle().fill(Theme.accent)
                                .frame(width: geo.size.width * min(1, max(0, Double(subs) / Double(next))))
                        }
                    }
                    .frame(height: 4)
                    Text(L("Hedef \(Fmt.number(next)) · \(Fmt.number(next - subs)) kaldı", "Goal \(Fmt.number(next)) · \(Fmt.number(next - subs)) to go"))
                        .font(.system(size: 11)).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 4)
    }
}

private struct DeltaRow: View {
    let label: String
    let value: Int

    var body: some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundStyle(Theme.muted)
            Spacer()
            Text(Fmt.signed(value)).font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(Theme.trend(value))
        }
    }
}

private struct EmptyPage: View {
    let message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("KANAL\nTAKİP").font(.system(size: 26, weight: .black)).foregroundStyle(Theme.text)
            Rectangle().fill(Theme.accent).frame(width: 24, height: 3)
            Text(message ?? L("iPhone'da Kanal Takip'i aç ve kanal ekle.", "Open Kanal Takip on your iPhone and add a channel."))
                .font(.system(size: 13)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}
