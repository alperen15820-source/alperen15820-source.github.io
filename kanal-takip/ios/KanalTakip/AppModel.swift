import Foundation
import Observation
import UIKit
import UserNotifications
import WidgetKit

@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    var state: AppState?
    var loading = false
    var errorMessage: String?
    var celebration: AppEvent?
    var openChannelId: String?
    var onboarded: Bool {
        didSet { UserDefaults.standard.set(onboarded, forKey: "onboarded") }
    }
    var notificationsDenied = false

    private var lastLoad = Date.distantPast
    private let cacheFile = SharedSettings.cacheDirectory.appendingPathComponent("state.json")
    private let seenKey = "celebratedUntil"

    init() {
        onboarded = UserDefaults.standard.bool(forKey: "onboarded")
        if DemoData.isEnabled {
            onboarded = !ProcessInfo.processInfo.arguments.contains("-onboarding")
            state = DemoData.state()
            if ProcessInfo.processInfo.arguments.contains("-celebrate") {
                celebration = state?.events?.first { $0.type == "milestone" }
            }
            openChannelId = DemoData.argument("-open")
            return
        }
        if let data = try? Data(contentsOf: cacheFile) {
            state = try? JSONDecoder().decode(AppState.self, from: data)
        }
    }

    var config: AppConfig? { state?.config }
    var cooldownHours: Double { state?.config?.alerts.cooldownHours ?? 3 }
    var maxChannels: Int { state?.limits?.maxChannels ?? 5 }

    // MARK: Hesap

    /// İlk açılışta sunucudan anonim bir hesap alır.
    private func client() async throws -> APIClient {
        guard let base = SharedSettings.baseURL else { throw APIError.notConfigured }
        if let token = SharedSettings.token { return APIClient(baseURL: base, token: token) }
        let token = try await APIClient.register(baseURL: base)
        SharedSettings.token = token
        let api = APIClient(baseURL: base, token: token)
        await registerStoredPushToken(api)
        return api
    }

    /// Sunucu hesabı tanımıyorsa (silinmiş) yenisini oluştur.
    private func withClient<T>(_ op: (APIClient) async throws -> T) async throws -> T {
        do {
            return try await op(try await client())
        } catch APIError.unauthorized {
            SharedSettings.token = nil
            return try await op(try await client())
        }
    }

    func deleteAccount() async throws {
        if !DemoData.isEnabled { try await withClient { try await $0.deleteAccount() } }
        SharedSettings.token = nil
        SharedSettings.cachedSummary = nil
        try? FileManager.default.removeItem(at: cacheFile)
        UserDefaults.standard.removeObject(forKey: seenKey)
        UserDefaults.standard.removeObject(forKey: "localeSynced")
        state = nil
        onboarded = false
        WidgetCenter.shared.reloadAllTimelines()
        WatchSync.shared.push()
    }

    // MARK: Veri

    func refresh(force: Bool = false) async {
        guard !loading, !DemoData.isEnabled else { return }
        if !force && Date().timeIntervalSince(lastLoad) < 20 { return }
        loading = true
        defer { loading = false }
        do {
            let (newState, data) = try await withClient { try await $0.state() }
            state = newState
            lastLoad = Date()
            errorMessage = nil
            try? data.write(to: cacheFile, options: .atomic)
            if let api = try? await client() {
                if let summary = try? await api.summary() {
                    SharedSettings.cachedSummary = summary
                    WidgetCenter.shared.reloadAllTimelines()
                }
                WatchSync.shared.push()
                await syncLocaleIfNeeded(api)
            }
            checkCelebration()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Telefonun dili veya saat dilimi değiştiyse sunucuya bildir (bildirim dili için).
    private func syncLocaleIfNeeded(_ api: APIClient) async {
        let current = "\(Lang.code)|\(TimeZone.current.identifier)"
        guard UserDefaults.standard.string(forKey: "localeSynced") != current else { return }
        if (try? await api.syncLocale()) != nil { UserDefaults.standard.set(current, forKey: "localeSynced") }
    }

    func saveConfig(_ config: AppConfig) async throws {
        if DemoData.isEnabled { state?.config = config; return }
        let saved = try await withClient { try await $0.saveConfig(config) }
        state?.config = saved
        // Yeni eklenen kanallar sunucuda hemen yoklanır; sonucu biraz sonra çek.
        try? await Task.sleep(for: .seconds(3))
        await refresh(force: true)
    }

    func refreshNow() async throws {
        try await withClient { try await $0.refreshNow() }
        await refresh(force: true)
    }

    func sendTest() async throws {
        try await withClient { try await $0.sendTest() }
    }

    // MARK: Kutlama

    private func checkCelebration() {
        let seen = UserDefaults.standard.double(forKey: seenKey)
        if let ev = state?.events?.first(where: { $0.type == "milestone" && $0.t > seen }) {
            celebration = ev
        }
    }

    func dismissCelebration() {
        if let ev = celebration { UserDefaults.standard.set(ev.t, forKey: seenKey) }
        celebration = nil
    }

    // MARK: Bildirimler

    func requestNotifications() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        notificationsDenied = !granted
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    func checkNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationsDenied = settings.authorizationStatus == .denied
        if settings.authorizationStatus == .authorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    func didReceivePushToken(_ token: String) {
        SharedSettings.defaults.set(token, forKey: "pushToken")
        Task { if let api = try? await client() { await registerStoredPushToken(api) } }
    }

    private func registerStoredPushToken(_ api: APIClient) async {
        guard let token = SharedSettings.defaults.string(forKey: "pushToken") else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        try? await api.registerDevice(token: token, environment: environment)
    }
}
