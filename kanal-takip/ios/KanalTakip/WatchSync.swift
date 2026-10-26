import Foundation
import WatchConnectivity

/// iPhone → Apple Watch: erişim anahtarını ve son özeti saate aktarır.
/// Saat, veriyi bundan sonra sunucudan kendisi çeker.
final class WatchSync: NSObject, WCSessionDelegate {
    static let shared = WatchSync()

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func push() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        var context: [String: Any] = ["token": SharedSettings.token ?? "", "t": Date().timeIntervalSince1970]
        if let summary = SharedSettings.cachedSummary, let data = try? JSONEncoder().encode(summary) {
            context["summary"] = data
        }
        try? session.updateApplicationContext(context)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        push()
    }

    func sessionWatchStateDidChange(_ session: WCSession) { push() }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}
