import SwiftUI

/// Minimal, sert renk paleti: siyah zemin, lacivert yüzeyler, tek vurgu rengi.
enum Theme {
    static let bg = Color(hex: 0x000000)
    static let surface = Color(hex: 0x07112B)
    static let surface2 = Color(hex: 0x0D1B40)
    static let line = Color(hex: 0x1A2A5C)
    static let text = Color.white
    static let muted = Color(hex: 0x7F8BB0)
    static let accent = Color(hex: 0x2E6BFF)
    static let up = Color(hex: 0x00E676)
    static let down = Color(hex: 0xFF3B3B)
    static let gold = Color(hex: 0xFFC400)

    static let radius: CGFloat = 4

    static func trend(_ n: Int) -> Color { n > 0 ? up : n < 0 ? down : muted }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

extension View {
    /// Küçük, büyük harfli, aralıklı etiket stili.
    func label() -> some View {
        font(.system(size: 11, weight: .bold)).tracking(1.2).foregroundStyle(Theme.muted).textCase(.uppercase)
    }

    func panel(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

enum Fmt {
    private static let full: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "tr_TR")
        f.maximumFractionDigits = 0
        return f
    }()

    private static let oneDecimal: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "tr_TR")
        f.maximumFractionDigits = 1
        return f
    }()

    static func number(_ n: Int?) -> String {
        guard let n else { return "—" }
        return full.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    /// 9.999'a kadar tam, sonra 12,3B / 1,2Mn
    static func compact(_ n: Int?) -> String {
        guard let n else { return "—" }
        let a = abs(Double(n))
        let sign = n < 0 ? "−" : ""
        if a < 10_000 { return sign + number(abs(n)) }
        if a < 1_000_000 { return sign + (oneDecimal.string(from: NSNumber(value: a / 1000)) ?? "") + "B" }
        if a < 1_000_000_000 { return sign + (oneDecimal.string(from: NSNumber(value: a / 1_000_000)) ?? "") + "Mn" }
        return sign + (oneDecimal.string(from: NSNumber(value: a / 1_000_000_000)) ?? "") + "Mr"
    }

    static func signed(_ n: Int) -> String {
        (n > 0 ? "+" : n < 0 ? "−" : "±") + compact(abs(n))
    }

    static func ago(_ date: Date?) -> String {
        guard let date else { return "—" }
        let s = max(0, Date().timeIntervalSince(date))
        if s < 60 { return "az önce" }
        if s < 3600 { return "\(Int(s / 60)) dk önce" }
        if s < 86400 { return "\(Int(s / 3600)) sa önce" }
        return "\(Int(s / 86400)) gün önce"
    }

    static func duration(_ sec: Int?) -> String? {
        guard let sec else { return nil }
        let h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

extension String {
    /// Sunucu başlıklarındaki baştaki emojiyi atar (minimal görünüm için).
    var withoutLeadingEmoji: String {
        var s = Substring(self)
        while let c = s.first, c.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation || $0.properties.generalCategory == .otherSymbol }) {
            s = s.dropFirst()
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
