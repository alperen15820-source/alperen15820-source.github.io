import Foundation

/// Basit iki dilli metin desteği: telefon/uygulama dili Türkçe ise Türkçe, değilse İngilizce.
enum Lang {
    static let isTurkish: Bool = {
        let bundleLangs = Bundle.main.localizations
        let code = bundleLangs.contains("tr")
            ? (Bundle.main.preferredLocalizations.first ?? "en")
            : (Locale.preferredLanguages.first ?? "en")
        return code.hasPrefix("tr")
    }()

    static var code: String { isTurkish ? "tr" : "en" }
    static var locale: Locale { Locale(identifier: isTurkish ? "tr_TR" : "en_US") }
}

/// Kullanım: `L("Kanallar", "Channels")`
func L(_ tr: String, _ en: String) -> String { Lang.isTurkish ? tr : en }

enum Links {
    static let privacy = URL(string: "https://alperen15820-source.github.io/kanaltakip-privacy.html")!
    static let support = URL(string: "https://alperen15820-source.github.io/kanaltakip-support.html")!
    static let youtubeTerms = URL(string: "https://www.youtube.com/t/terms")!
    static let googlePrivacy = URL(string: "https://policies.google.com/privacy")!
}
