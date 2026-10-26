import SwiftUI
import UserNotifications

@main
struct KanalTakipApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active, model.onboarded else { return }
                    Task {
                        await model.checkNotificationStatus()
                        await model.refresh()
                    }
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        WatchSync.shared.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in AppModel.shared.didReceivePushToken(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push kaydı başarısız: \(error.localizedDescription)")
    }

    // Uygulama açıkken de bildirimi göster ve veriyi yenile.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await AppModel.shared.refresh(force: true)
        return [.banner, .sound, .list]
    }

    // Bildirime dokunulunca ilgili kanalı aç.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let channelId = response.notification.request.content.userInfo["channelId"] as? String
        await MainActor.run { AppModel.shared.openChannelId = channelId }
        await AppModel.shared.refresh(force: true)
    }
}
