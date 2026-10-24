import AppIntents
import UserNotifications
import WidgetKit

/// Kısayollar otomasyonundan (alarm durdurulunca / uyanınca) çalışır ve
/// kanalların son 24 saatini bildirim olarak gösterir.
struct MorningSummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "Sabah Özeti"
    static var description = IntentDescription("YouTube kanallarının son 24 saatini bildirim olarak gösterir.")
    static var openAppWhenRun = false

    @Parameter(title: "Günde yalnızca bir kez", default: true)
    var oncePerDay: Bool

    func perform() async throws -> some IntentResult {
        guard let api = APIClient() else { throw APIError.server("Önce Kanal Takip uygulamasında sunucuyu bağla.") }

        let today = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970
        let key = "morningShownDay"
        if oncePerDay, SharedSettings.defaults.double(forKey: key) == today { return .result() }

        let summary = try await api.summary()
        SharedSettings.cachedSummary = summary
        WidgetCenter.shared.reloadAllTimelines()

        let content = UNMutableNotificationContent()
        content.title = summary.title.withoutLeadingEmoji
        content.body = summary.body
        content.sound = .default
        content.threadIdentifier = "morning"
        content.interruptionLevel = .active
        try await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "morning-\(Int(today))", content: content, trigger: nil)
        )

        SharedSettings.defaults.set(today, forKey: key)
        try? await api.ackMorning()
        return .result()
    }
}

struct KanalTakipShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: MorningSummaryIntent(),
            phrases: [
                "\(.applicationName) sabah özeti",
                "\(.applicationName) özetini göster",
            ],
            shortTitle: "Sabah Özeti",
            systemImageName: "sun.max.fill"
        )
    }
}
