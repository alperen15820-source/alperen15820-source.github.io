import Foundation

// Sunucudaki (Cloudflare Worker) JSON yapısının karşılıkları.

struct AppState: Codable {
    var updatedAt: Double?
    var error: String?
    var order: [String]?
    var channels: [String: Channel]
    var events: [AppEvent]?
    var config: AppConfig?
    var devices: Int?
    var push: Bool?

    var orderedChannels: [Channel] {
        let ids = order ?? Array(channels.keys).sorted()
        return ids.compactMap { channels[$0] }
    }

    var updatedDate: Date? { updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

/// Geçmiş noktası: kanal için [zaman(ms), abone, izlenme], video için [zaman(ms), izlenme].
typealias HistPoint = [Double]

enum Metric: Int {
    case subs = 1
    case views = 2
}

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var handle: String?
    var thumb: String?
    var url: String?
    var subs: Int?
    var views: Int
    var videoCount: Int
    var hist: [HistPoint]
    var celebrated: [Int]?
    var videos: [String: Video]?
    var latest: [String]?

    var latestVideos: [Video] { (latest ?? []).compactMap { videos?[$0] } }
    var thumbURL: URL? { thumb.flatMap(URL.init(string:)) }
    var youtubeURL: URL? { url.flatMap(URL.init(string:)) }

    func gain(_ metric: Metric, over seconds: TimeInterval) -> History.Gain? {
        History.gain(hist, index: metric.rawValue, over: seconds)
    }
}

struct Video: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var thumb: String?
    var publishedAt: String
    var duration: Int?
    var live: String?
    var views: Int
    var likes: Int?
    var comments: Int?
    var hist: [HistPoint]
    var lastAlert: Double?

    var thumbURL: URL? { thumb.flatMap(URL.init(string:)) }
    var watchURL: URL? { URL(string: "https://www.youtube.com/watch?v=\(id)") }
    var publishedDate: Date? { ISO8601DateFormatter().date(from: publishedAt) }

    var viewsPerHour: Double? {
        guard let g = History.gain(hist, index: 1, over: 3600), g.hours >= 0.25 else { return nil }
        return Double(g.delta) / g.hours
    }

    func isSpiking(cooldownHours: Double) -> Bool {
        guard let t = lastAlert, t > 0 else { return false }
        return Date().timeIntervalSince1970 * 1000 - t < cooldownHours * 3_600_000
    }
}

struct AppEvent: Codable, Identifiable, Hashable {
    let id: String
    var t: Double
    var type: String
    var title: String
    var body: String
    var channelId: String?
    var channel: String?
    var videoId: String?
    var url: String?
    var milestone: Int?

    var date: Date { Date(timeIntervalSince1970: t / 1000) }
}

struct Alerts: Codable, Hashable {
    var spikeMultiplier: Double
    var videoMinViewsPerHour: Double
    var channelMinViewsPerHour: Double
    var subsPerHour: Double
    var newVideo: Bool
    var cooldownHours: Double
}

struct AppConfig: Codable, Hashable {
    var channels: [String]
    var milestones: [Int]
    var alerts: Alerts
    var timezone: String
    var trackLatestVideos: Int
    var morningFallbackHour: Int?

    enum CodingKeys: String, CodingKey {
        case channels, milestones, alerts, timezone, trackLatestVideos, morningFallbackHour
    }

    // null'ı açıkça gönder ki sunucu yedek saati kapatabilsin.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(channels, forKey: .channels)
        try c.encode(milestones, forKey: .milestones)
        try c.encode(alerts, forKey: .alerts)
        try c.encode(timezone, forKey: .timezone)
        try c.encode(trackLatestVideos, forKey: .trackLatestVideos)
        if let h = morningFallbackHour { try c.encode(h, forKey: .morningFallbackHour) } else { try c.encodeNil(forKey: .morningFallbackHour) }
    }

    func nextMilestone(after subs: Int) -> (prev: Int, next: Int)? {
        guard let next = milestones.first(where: { $0 > subs }) else { return nil }
        let prev = milestones.last(where: { $0 <= subs }) ?? 0
        return (prev, next)
    }
}

struct Summary: Codable {
    struct Item: Codable, Identifiable {
        struct Top: Codable { var id: String; var title: String; var gain: Int }
        var id: String
        var title: String
        var thumb: String?
        var subs: Int?
        var views: Int
        var subsDelta: Int
        var viewsDelta: Int
        var hours: Double
        var nextMilestone: Int?
        var topVideo: Top?
    }

    var updatedAt: Double?
    var error: String?
    var totalSubs: Int
    var totalSubsDelta: Int
    var totalViewsDelta: Int
    var channels: [Item]
    var title: String
    var body: String

    static let sample = Summary(
        updatedAt: Date().timeIntervalSince1970 * 1000, error: nil,
        totalSubs: 14_820, totalSubsDelta: 46, totalViewsDelta: 12_400,
        channels: [
            Item(id: "1", title: "Otomasyon", subs: 994, views: 52_000, subsDelta: 14, viewsDelta: 1_020, hours: 24, nextMilestone: 1000),
            Item(id: "2", title: "Bilgi Kutusu", subs: 12_600, views: 2_100_000, subsDelta: 25, viewsDelta: 8_200, hours: 24, nextMilestone: 25_000),
            Item(id: "3", title: "Shorts Lab", subs: 1_226, views: 310_000, subsDelta: 7, viewsDelta: 3_180, hours: 24, nextMilestone: 2000),
        ],
        title: "Günaydın", body: ""
    )
}

enum History {
    struct Gain { var delta: Int; var hours: Double }

    static func point(_ hist: [HistPoint], atOrBefore t: Double) -> HistPoint? {
        var found: HistPoint?
        for p in hist {
            if p[0] <= t { found = p } else { break }
        }
        return found
    }

    static func gain(_ hist: [HistPoint], index: Int, over seconds: TimeInterval) -> Gain? {
        guard let last = hist.last, last.count > index else { return nil }
        let ref = point(hist, atOrBefore: last[0] - seconds * 1000) ?? hist[0]
        guard ref[0] < last[0], ref.count > index else { return nil }
        return Gain(delta: Int(last[index] - ref[index]), hours: (last[0] - ref[0]) / 3_600_000)
    }
}
