import Foundation
import Observation
import UIKit
import WidgetKit

@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    var server: ServerConfig? = SharedSettings.server
    var state: AppState?
    var loading = false
    var errorMessage: String?
    var celebration: AppEvent?
    var openChannelId: String?

    private var lastLoad = Date.distantPast
    private let cacheFile = SharedSettings.cacheDirectory.appendingPathComponent("state.json")
    private let seenKey = "celebratedUntil"

    init() {
        if DemoData.isEnabled {
            server = ServerConfig(url: URL(string: "https://demo.invalid")!, secret: "demo")
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

    // MARK: Sunucu bağlantısı

    func connect(url: URL, secret: String) async throws {
        let candidate = ServerConfig(url: url, secret: secret)
        _ = try await APIClient(server: candidate).state()
        SharedSettings.server = candidate
        server = candidate
        await registerStoredPushToken()
        await refresh(force: true)
    }

    func disconnect() {
        SharedSettings.server = nil
        server = nil
        state = nil
        try? FileManager.default.removeItem(at: cacheFile)
    }

    /// kanaltakip://kurulum?url=...&secret=...
    func handle(url: URL) {
        guard url.scheme == "kanaltakip",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "url" })?.value, let serverURL = URL(string: raw),
              let secret = items.first(where: { $0.name == "secret" })?.value else { return }
        Task {
            do { try await connect(url: serverURL, secret: secret) } catch { errorMessage = error.localizedDescription }
        }
    }

    // MARK: Veri

    func refresh(force: Bool = false) async {
        guard let server, !loading, !DemoData.isEnabled else { return }
        if !force && Date().timeIntervalSince(lastLoad) < 20 { return }
        loading = true
        defer { loading = false }
        do {
            let api = APIClient(server: server)
            let (newState, data) = try await api.state()
            state = newState
            lastLoad = Date()
            errorMessage = nil
            try? data.write(to: cacheFile, options: .atomic)
            if let summary = try? await api.summary() {
                SharedSettings.cachedSummary = summary
                WidgetCenter.shared.reloadAllTimelines()
            }
            checkCelebration()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveConfig(_ config: AppConfig) async throws {
        guard let server else { return }
        let saved = try await APIClient(server: server).saveConfig(config)
        state?.config = saved
        // Kanal listesi değiştiyse sunucu hemen bir tur çalıştırır; sonucu biraz sonra çek.
        try? await Task.sleep(for: .seconds(4))
        await refresh(force: true)
    }

    func runNow() async throws {
        guard let server else { return }
        try await APIClient(server: server).runNow()
        await refresh(force: true)
    }

    func sendTest() async throws {
        guard let server else { return }
        try await APIClient(server: server).sendTest()
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

    // MARK: Push

    func didReceivePushToken(_ token: String) {
        SharedSettings.defaults.set(token, forKey: "pushToken")
        Task { await registerStoredPushToken() }
    }

    func registerStoredPushToken() async {
        guard let server, let token = SharedSettings.defaults.string(forKey: "pushToken") else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            try await APIClient(server: server).registerDevice(token: token, environment: environment, name: UIDevice.current.name)
        } catch {
            errorMessage = "Bildirim kaydı başarısız: \(error.localizedDescription)"
        }
    }
}
