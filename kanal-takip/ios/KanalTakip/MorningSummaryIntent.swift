import AppIntents
import UserNotifications
import WidgetKit

/// Kısayollar otomasyonundan (alarm durdurulunca / uyanınca) çalışır ve
/// kanalların son 24 saatini bildirim olarak gösterir.
struct MorningSummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "Morning Summary"
    static var description = IntentDescription("Shows the last 24 hours of your YouTube channels as a notification.")
    static var openAppWhenRun = false

    @Parameter(title: "Only once per day", default: true)
    var oncePerDay: Bool

    func perform() async throws -> some IntentResult {
        guard let api = APIClient() else { throw APIError.server(L("Önce Kanal Takip uygulamasını açıp kanal ekle.", "Open Kanal Takip and add a channel first.")) }

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
                "\(.applicationName) morning summary",
                "\(.applicationName) sabah özeti",
                "Show \(.applicationName) summary",
            ],
            shortTitle: "Morning Summary",
            systemImageName: "sun.max.fill"
        )
    }
}
