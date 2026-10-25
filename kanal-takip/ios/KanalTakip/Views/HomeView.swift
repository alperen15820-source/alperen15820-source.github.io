import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            Screen(title: L("Kanallar", "Channels"), large: true) {
                if let msg = model.errorMessage { ErrorBanner(message: msg) }
                if let msg = model.state?.error { ErrorBanner(message: msg) }
                if let updated = model.state?.updatedDate, Date().timeIntervalSince(updated) > 3600 {
                    ErrorBanner(message: L("Veriler \(Fmt.ago(updated)) güncellendi. Bağlantını kontrol et.", "Data last updated \(Fmt.ago(updated)). Check your connection."))
                }

                let channels = model.state?.orderedChannels ?? []
                if channels.isEmpty {
                    EmptyChannels()
                } else {
                    TotalsPanel(channels: channels, updated: model.state?.updatedDate)
                    VStack(spacing: 0) {
                        ForEach(channels) { c in
                            NavigationLink(value: c.id) { ChannelRow(channel: c, config: model.config) }
                                .buttonStyle(.plain)
                            if c.id != channels.last?.id { Rectangle().fill(Theme.line).frame(height: 1) }
                        }
                    }
                    .background(Theme.surface)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
            }
            .refreshable { await model.refresh(force: true) }
            .navigationDestination(for: String.self) { id in
                if let c = model.state?.channels[id] { ChannelDetailView(channel: c) }
            }
            .onChange(of: model.openChannelId) { _, _ in openPendingChannel() }
            .onAppear { openPendingChannel() }
        }
    }
}

extension HomeView {
    /// Bildirime dokunulduğunda ilgili kanalın detayını aç.
    private func openPendingChannel() {
        guard let id = model.openChannelId, model.state?.channels[id] != nil else { return }
        path = [id]
        model.openChannelId = nil
    }
}

private struct TotalsPanel: View {
    let channels: [Channel]
    let updated: Date?

    var body: some View {
        let subs = channels.compactMap(\.subs).reduce(0, +)
        let subs24 = channels.compactMap { $0.gain(.subs, over: 86400)?.delta }.reduce(0, +)
        let views24 = channels.compactMap { $0.gain(.views, over: 86400)?.delta }.reduce(0, +)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(L("Toplam abone", "Total subscribers")).label()
                Spacer()
                Text(Fmt.ago(updated)).font(.caption2).foregroundStyle(Theme.muted)
            }
            Text(Fmt.number(subs))
                .font(.system(size: 52, weight: .heavy, design: .default).monospacedDigit())
                .foregroundStyle(Theme.text)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            HStack(spacing: 0) {
                Stat(title: L("Abone · 24s", "Subs · 24h"), value: Fmt.signed(subs24), color: Theme.trend(subs24))
                Rectangle().fill(Theme.line).frame(width: 1, height: 34)
                Stat(title: L("İzlenme · 24s", "Views · 24h"), value: Fmt.signed(views24), color: Theme.trend(views24))
                    .padding(.leading, 16)
            }
        }
        .panel()
    }
}

struct Stat: View {
    let title: String
    let value: String
    var color: Color = Theme.text

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).label()
            Text(value).font(.system(size: 22, weight: .bold).monospacedDigit()).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ChannelRow: View {
    let channel: Channel
    let config: AppConfig?

    var body: some View {
        let d = channel.gain(.subs, over: 86400)?.delta ?? 0
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Avatar(url: channel.thumbURL, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(channel.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
                    Text(L("\(Fmt.compact(channel.views)) izlenme", "\(Fmt.compact(channel.views)) views")).font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Fmt.number(channel.subs)).font(.system(size: 20, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.text)
                    Text(Fmt.signed(d)).font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(Theme.trend(d))
                }
            }
            if let subs = channel.subs, let goal = config?.nextMilestone(after: subs) {
                GoalBar(subs: subs, prev: goal.prev, next: goal.next, height: 2)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
    }
}

struct GoalBar: View {
    let subs: Int
    let prev: Int
    let next: Int
    var height: CGFloat = 6

    var body: some View {
        let pct = max(0, min(1, Double(subs - prev) / Double(max(next - prev, 1))))
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Theme.surface2)
                Rectangle().fill(next == 1000 ? Theme.gold : Theme.accent).frame(width: geo.size.width * pct)
            }
        }
        .frame(height: height)
    }
}

struct Avatar: View {
    let url: URL?
    var size: CGFloat = 40

    var body: some View {
        AsyncImage(url: url) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            Rectangle().fill(Theme.surface2)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

private struct EmptyChannels: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("Henüz kanal yok", "No channels yet")).font(.headline).foregroundStyle(Theme.text)
            Text(L("Ayarlar → Kanallar bölümünden takip etmek istediğin kanalları ekle (ör. @kanaladi). İlk veriler birkaç saniye içinde gelir.", "Add channels in Settings → Channels (e.g. @handle). First data arrives within seconds."))
                .font(.subheadline).foregroundStyle(Theme.muted)
        }
        .panel()
    }
}
