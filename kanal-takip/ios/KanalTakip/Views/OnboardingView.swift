import SwiftUI

/// İlk açılış: tanıtım → bildirim izni → kanal ekleme.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var step = 0
    @State private var channels: [String] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("KANAL\nTAKİP").font(.system(size: 48, weight: .black)).foregroundStyle(Theme.text)
                    Rectangle().fill(Theme.accent).frame(width: 48, height: 4)
                }
                .padding(.top, 48)

                if step == 0 { intro } else { channelStep }
            }
            .padding(16)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(L("YouTube kanallarını takip et, önemli anı kaçırma.", "Track your YouTube channels. Never miss a big moment."))
                .font(.title3.weight(.semibold)).foregroundStyle(Theme.text)
            VStack(alignment: .leading, spacing: 16) {
                Feature(icon: "flame.fill", title: L("Sıçrama bildirimi", "Spike alerts"),
                        text: L("Bir video normalden hızlı izlenmeye başlayınca haber verir.", "Get notified when a video starts taking off."))
                Feature(icon: "trophy.fill", title: L("Abone hedefleri", "Subscriber milestones"),
                        text: L("100, 1000, 10.000… her hedefte kutlama.", "Celebrate 100, 1,000, 10,000 and beyond."))
                Feature(icon: "sun.max.fill", title: L("Sabah özeti", "Morning summary"),
                        text: L("Alarmını kapattığında dünün özeti gelir.", "Yesterday's recap when you turn off your alarm."))
                Feature(icon: "rectangle.on.rectangle", title: L("Kilit ekranı widget'ı", "Lock Screen widget"),
                        text: L("Telefonu eline aldığın an son 24 saat.", "The last 24 hours at a glance."))
            }
            PrimaryButton(title: L("Başla", "Get started")) {
                Task {
                    await model.requestNotifications()
                    withAnimation { step = 1 }
                }
            }
            .padding(.top, 8)
        }
    }

    private var channelStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L("Hangi kanalları takip edelim?", "Which channels should we track?"))
                .font(.title3.weight(.semibold)).foregroundStyle(Theme.text)
            Text(L("Kendi kanalını veya herhangi bir herkese açık kanalı ekle: @kanaladi ya da kanal linki.",
                   "Add your own or any public channel: @handle or a channel link."))
                .font(.subheadline).foregroundStyle(Theme.muted)
            ChannelListEditor(channels: $channels, max: model.maxChannels).panel()
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.down) }
            PrimaryButton(title: busy ? L("Ekleniyor…", "Adding…") : L("Takibe başla", "Start tracking"),
                          disabled: busy || channels.isEmpty) {
                Task { await save() }
            }
            Button(L("Şimdilik atla", "Skip for now")) { model.onboarded = true }
                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var config = model.config ?? AppConfig.defaults
        config.channels = channels
        do {
            try await model.saveConfig(config)
            error = nil
            model.onboarded = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct Feature: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.text)
                .frame(width: 36, height: 36).background(Theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                Text(text).font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }
}
