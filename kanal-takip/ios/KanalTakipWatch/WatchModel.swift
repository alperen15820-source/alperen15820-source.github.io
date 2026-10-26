import Foundation
import Observation
import WatchConnectivity
import WidgetKit

/// Saat tarafı: erişim anahtarını iPhone'dan (WatchConnectivity) alır, özeti
/// sunucudan doğrudan çeker ve komplikasyonları yeniler.
@MainActor
@Observable
final class WatchModel: NSObject, WCSessionDelegate {
    static let shared = WatchModel()

    var summary: Summary? = DemoMode.isEnabled ? .sample : SharedSettings.cachedSummary
    var loading = false
    var error: String?

    func start() {
        guard !DemoMode.isEnabled, WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func refresh() async {
        guard !DemoMode.isEnabled, !loading else { return }
        guard let api = APIClient() else {
            error = L("iPhone'da Kanal Takip'i aç ve kanal ekle.", "Open Kanal Takip on your iPhone and add a channel.")
            return
        }
        loading = true
        defer { loading = false }
        do {
            let fresh = try await api.summary()
            summary = fresh
            error = nil
            SharedSettings.cachedSummary = fresh
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: WCSessionDelegate

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext
        Task { @MainActor in self.apply(context) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }

    private func apply(_ context: [String: Any]) {
        guard let token = context["token"] as? String else { return }
        SharedSettings.token = token.isEmpty ? nil : token
        if let data = context["summary"] as? Data, let s = try? JSONDecoder().decode(Summary.self, from: data) {
            summary = s
            SharedSettings.cachedSummary = s
        } else if token.isEmpty {
            summary = nil
            SharedSettings.cachedSummary = nil
        }
        WidgetCenter.shared.reloadAllTimelines()
        Task { await refresh() }
    }
}

enum DemoMode {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-demo") }
}
