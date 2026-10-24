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
            channel("otomasyon", "Otomasyon Kanalı", history(subs: 640, views: 41_000, subsPerDay: 12, viewsPerDay: 900, burst: true), [
                video("d1", "Yapay zekâ ile 1 günde 10 Shorts ürettim", ageHours: 20, views: 6_400, perHour: 260, spiking: true),
                video("d2", "Faceless kanal açmak: sıfırdan rehber", ageHours: 96, views: 3_100, perHour: 22),
                video("d3", "En çok izlenen 5 otomasyon aracı", ageHours: 200, views: 1_800, perHour: 6),
            ]),
            channel("bilgikutusu", "Bilgi Kutusu", history(subs: 11_800, views: 2_100_000, subsPerDay: 25, viewsPerDay: 6_000), [
                video("d4", "Günün en ilginç 10 bilgisi", ageHours: 5, views: 8_200, perHour: 1_500),
                video("d5", "Bunları biliyor muydun? #shorts", ageHours: 60, views: 41_000, perHour: 300),
            ]),
            channel("shortslab", "Shorts Lab", history(subs: 1_100, views: 280_000, subsPerDay: 4, viewsPerDay: 2_500), [
                video("d6", "30 saniyede Excel hilesi", ageHours: 30, views: 12_000, perHour: 210),
            ]),
            channel("gecehikaye", "Gece Hikâyeleri", history(subs: 420, views: 18_000, subsPerDay: 3, viewsPerDay: 250), [
                video("d7", "Terk edilmiş köyün sırrı", ageHours: 70, views: 2_400, perHour: 18),
            ]),
            channel("teknohaber", "Tekno Haber", history(subs: 3_300, views: 640_000, subsPerDay: 9, viewsPerDay: 4_100), [
                video("d8", "Yeni iPhone'un gizli özellikleri", ageHours: 12, views: 9_800, perHour: 420),
            ]),
        ]

        let events = [
            AppEvent(id: "e1", t: now - 4 * 60_000, type: "milestone", title: "🏆 1000 ABONE — Otomasyon Kanalı",
                     body: "Tebrikler! 1000 abone barajı geçildi. Para kazanma (YPP) için ilk büyük şart tamam — sırada 4000 saat izlenme ya da 10M Shorts izlenmesi var. 🚀",
                     channelId: "otomasyon", channel: "Otomasyon Kanalı", milestone: 1000),
            AppEvent(id: "e2", t: now - 20 * 60_000, type: "spike_video", title: "🔥 Sıçrama — Yapay zekâ ile 1 günde 10 Shorts ürettim",
                     body: "Saatte ~2.080 izlenme (normalin 8,0 katı). Toplam 6.400 · Otomasyon Kanalı", channelId: "otomasyon", videoId: "d1"),
            AppEvent(id: "e3", t: now - 5 * hour, type: "new_video", title: "🎬 Yeni video — Bilgi Kutusu",
                     body: "Günün en ilginç 10 bilgisi", channelId: "bilgikutusu", videoId: "d4"),
            AppEvent(id: "e4", t: now - 7 * hour, type: "subs_jump", title: "👥 Abone yağıyor — Tekno Haber",
                     body: "Son bir saatte +14 abone. Şu an 3.312.", channelId: "teknohaber"),
            AppEvent(id: "e5", t: now - 22 * hour, type: "morning", title: "☀️ Günaydın — dün +53 abone, +13,6B izlenme",
                     body: "En iyi: Günün en ilginç 10 bilgisi (+8.200)"),
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
