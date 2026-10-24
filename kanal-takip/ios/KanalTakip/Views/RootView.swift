import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab = 0

    var body: some View {
        @Bindable var model = model
        Group {
            if model.server == nil {
                SetupView()
            } else {
                TabView(selection: $tab) {
                    HomeView()
                        .tabItem { Label("Kanallar", systemImage: "square.grid.2x2.fill") }
                        .tag(0)
                    EventsView()
                        .tabItem { Label("Olaylar", systemImage: "bolt.fill") }
                        .tag(1)
                    SettingsView()
                        .tabItem { Label("Ayarlar", systemImage: "slider.horizontal.3") }
                        .tag(2)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullScreenCover(item: $model.celebration) { ev in
            CelebrationView(event: ev) { model.dismissCelebration() }
        }
        .onChange(of: model.openChannelId) { _, id in
            if id != nil { tab = 0 }
        }
        .task { await model.refresh(force: true) }
    }
}

/// Ekranlar arasında ortak arka plan ve gezinme çubuğu görünümü.
struct Screen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { content }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(title)
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().fill(Theme.down).frame(width: 3)
            Text(message).font(.footnote).foregroundStyle(Theme.text)
        }
        .fixedSize(horizontal: false, vertical: true)
        .panel(padding: 12)
    }
}
