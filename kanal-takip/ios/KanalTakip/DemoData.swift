import Foundation

/// `-demo` başlatma argümanıyla açıldığında sunucu yerine örnek veri gösterilir
/// (Xcode → Scheme → Arguments ya da simülatör ekran görüntüleri için).
enum DemoData {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-demo") }

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static func state() -> AppState {
        let now = Date().timeIntervalSince1970 * 1000
        let hour = 3_600_000.0
        var rng = SystemRandomNumberGenerator()

        func history(subs: Double, views: Double, subsPerDay: Double, viewsPerDay: Double, burst: Bool = false) -> [HistPoint] {
            var out: [HistPoint] = []
            var s = subs, v = views
            var t = now - 30 * 24 * hour
            while t <= now {
                let step = t < now - 48 * hour ? hour : hour / 6
                let k = step / (24 * hour)
                let boost = burst && now - t < 1.2 * hour ? 6.0 : 1.0
                s += subsPerDay * k * Double.random(in: 0.4...1.6, using: &rng) * (boost > 1 ? 2 : 1)
                v += viewsPerDay * k * Double.random(in: 0.5...1.5, using: &rng) * boost
                out.append([t, s.rounded(), v.rounded()])
                t += step
            }
            return out
        }

        func video(_ id: String, _ title: String, ageHours: Double, views: Double, perHour: Double, spiking: Bool = false) -> Video {
            var hist: [HistPoint] = []
            let span = min(ageHours, 48)
            var v = views - perHour * span
            var t = now - span * hour
            while t <= now {
                v += perHour / 6 * (spiking && now - t < hour ? 8 : 1)
                hist.append([t, v.rounded()])
                t += hour / 6
            }
            let views = Int(hist.last?[1] ?? views)
            return Video(id: id, title: title, thumb: nil,
                         publishedAt: ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: (now - ageHours * hour) / 1000)),
                         duration: Int.random(in: 30...720), live: nil, views: views,
                         likes: views / 25, comments: views / 250, hist: hist,
                         lastAlert: spiking ? now - 20 * 60_000 : 0)
        }

        func channel(_ id: String, _ title: String, _ hist: [HistPoint], _ videos: [Video]) -> Channel {
            Channel(id: id, title: title, handle: "@\(id)", thumb: nil, url: "https://www.youtube.com",
                    subs: Int(hist.last![1]), views: Int(hist.last![2]), videoCount: 40 + videos.count,
                    hist: hist, celebrated: [], videos: Dictionary(uniqueKeysWithValues: videos.map { ($0.id, $0) }),
                    latest: videos.map(\.id))
        }

        let channels = [
            channel("otomasyon", L("Otomasyon Kanalı", "Automation Lab"), history(subs: 640, views: 41_000, subsPerDay: 12, viewsPerDay: 900, burst: true), [
                video("d1", L("Yapay zekâ ile 1 günde 10 Shorts ürettim", "I made 10 Shorts in one day with AI"), ageHours: 20, views: 6_400, perHour: 260, spiking: true),
                video("d2", L("Faceless kanal açmak: sıfırdan rehber", "Starting a faceless channel from zero"), ageHours: 96, views: 3_100, perHour: 22),
                video("d3", L("En çok izlenen 5 otomasyon aracı", "Top 5 automation tools"), ageHours: 200, views: 1_800, perHour: 6),
            ]),
            channel("bilgikutusu", L("Bilgi Kutusu", "Fact Box"), history(subs: 11_800, views: 2_100_000, subsPerDay: 25, viewsPerDay: 6_000), [
                video("d4", L("Günün en ilginç 10 bilgisi", "10 wild facts of the day"), ageHours: 5, views: 8_200, perHour: 1_500),
                video("d5", L("Bunları biliyor muydun? #shorts", "Did you know this? #shorts"), ageHours: 60, views: 41_000, perHour: 300),
            ]),
            channel("shortslab", "Shorts Lab", history(subs: 1_100, views: 280_000, subsPerDay: 4, viewsPerDay: 2_500), [
                video("d6", L("30 saniyede Excel hilesi", "Excel trick in 30 seconds"), ageHours: 30, views: 12_000, perHour: 210),
            ]),
            channel("gecehikaye", L("Gece Hikâyeleri", "Night Stories"), history(subs: 420, views: 18_000, subsPerDay: 3, viewsPerDay: 250), [
                video("d7", L("Terk edilmiş köyün sırrı", "The secret of the abandoned village"), ageHours: 70, views: 2_400, perHour: 18),
            ]),
            channel("teknohaber", L("Tekno Haber", "Tech Daily"), history(subs: 3_300, views: 640_000, subsPerDay: 9, viewsPerDay: 4_100), [
                video("d8", L("Yeni iPhone'un gizli özellikleri", "Hidden features of the new iPhone"), ageHours: 12, views: 9_800, perHour: 420),
            ]),
        ]

        let a = channels[0].title, b = channels[1].title, e = channels[4].title
        let v1 = channels[0].latestVideos[0].title, v4 = channels[1].latestVideos[0].title
        let events = [
            AppEvent(id: "e1", t: now - 4 * 60_000, type: "milestone", title: L("🏆 1000 ABONE — \(a)", "🏆 1,000 SUBSCRIBERS — \(a)"),
                     body: L("Tebrikler! 1000 abone barajı geçildi. Para kazanma (YPP) için ilk büyük şart tamam — sırada 4000 saat izlenme ya da 10M Shorts izlenmesi var. 🚀",
                             "Congrats! You crossed 1,000 subscribers — the first big step toward the YouTube Partner Program. Next up: 4,000 watch hours or 10M Shorts views. 🚀"),
                     channelId: "otomasyon", channel: a, milestone: 1000),
            AppEvent(id: "e2", t: now - 20 * 60_000, type: "spike_video", title: L("🔥 Sıçrama — \(v1)", "🔥 Spike — \(v1)"),
                     body: L("Saatte ~2.080 izlenme (normalin 8,0 katı). Toplam 6.400 · \(a)", "~2,080 views/hour (8.0× normal). Total 6,400 · \(a)"), channelId: "otomasyon", videoId: "d1"),
            AppEvent(id: "e3", t: now - 5 * hour, type: "new_video", title: L("🎬 Yeni video — \(b)", "🎬 New video — \(b)"),
                     body: v4, channelId: "bilgikutusu", videoId: "d4"),
            AppEvent(id: "e4", t: now - 7 * hour, type: "subs_jump", title: L("👥 Abone yağıyor — \(e)", "👥 Subscribers pouring in — \(e)"),
                     body: L("Son bir saatte +14 abone. Şu an 3.312.", "+14 subscribers in the last hour. Now at 3,312."), channelId: "teknohaber"),
            AppEvent(id: "e5", t: now - 22 * hour, type: "morning", title: L("☀️ Günaydın — dün +53 abone, +13,6B izlenme", "☀️ Good morning — +53 subscribers, +13.6K views yesterday"),
                     body: L("En iyi: \(v4) (+8.200)", "Top: \(v4) (+8,200)")),
        ]

        let config = AppConfig(
            channels: ["@otomasyon", "@bilgikutusu", "@shortslab", "@gecehikaye", "@teknohaber"],
            milestones: [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000],
            alerts: Alerts(spikeMultiplier: 3, videoMinViewsPerHour: 50, channelMinViewsPerHour: 100, subsPerHour: 10, newVideo: true, cooldownHours: 3),
            timezone: "Europe/Istanbul", trackLatestVideos: 10, morningFallbackHour: nil
        )

        return AppState(updatedAt: now - 3 * 60_000, error: nil, order: channels.map(\.id),
                        channels: Dictionary(uniqueKeysWithValues: channels.map { ($0.id, $0) }),
                        events: events, config: config, devices: 1, push: true)
    }
}
