import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var draft: AppConfig?
    @State private var busy = false
    @State private var message: (String, Bool)?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Screen(title: L("Ayarlar", "Settings"), large: true) {
                if let message {
                    Text(message.0).font(.footnote.weight(.semibold))
                        .foregroundStyle(message.1 ? Theme.up : Theme.down)
                        .panel(padding: 12)
                }
                if model.notificationsDenied { notificationsOff }

                let binding = Binding(get: { draft ?? model.config ?? .defaults }, set: { draft = $0 })
                channelsSection(binding)
                alertsSection(binding)
                morningSection(binding)
                PrimaryButton(title: busy ? L("Kaydediliyor…", "Saving…") : L("Ayarları kaydet", "Save settings"),
                              disabled: busy || draft == nil || draft == model.config) {
                    Task { await save() }
                }
                aboutSection
            }
            .scrollDismissesKeyboard(.interactively)
            // Kaydedilmemiş değişiklik yoksa sunucudaki son hâli göster
            .onChange(of: model.config) { old, new in if draft == old { draft = nil } }
        }
    }

    private var notificationsOff: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Bildirimler kapalı", "Notifications are off")).font(.headline).foregroundStyle(Theme.text)
            Text(L("Sıçrama ve hedef bildirimleri için iPhone Ayarlar'ından bildirimlere izin ver.", "Allow notifications in iPhone Settings to get spike and milestone alerts."))
                .font(.subheadline).foregroundStyle(Theme.muted)
            SecondaryButton(title: L("Ayarları aç", "Open Settings")) {
                if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) }
            }
        }
        .panel()
    }

    // MARK: Kanallar

    private func channelsSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Kanallar · \(cfg.wrappedValue.channels.count)/\(model.maxChannels)", "Channels · \(cfg.wrappedValue.channels.count)/\(model.maxChannels)")).label()
            ChannelListEditor(channels: cfg.channels, max: model.maxChannels, names: displayName)
        }
        .panel()
    }

    private func displayName(for ref: String) -> String {
        let lower = ref.lowercased()
        if let c = model.state?.orderedChannels.first(where: { ref.contains($0.id) || ($0.handle?.lowercased()).map { lower.hasSuffix($0) } == true }) {
            return "\(c.title)  ·  \(ref)"
        }
        return ref
    }

    // MARK: Bildirim eşikleri

    private func alertsSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L("Bildirimler", "Notifications")).label()
            NumberStepper(title: L("Sıçrama eşiği", "Spike threshold"), suffix: L("× normal", "× normal"), value: cfg.alerts.spikeMultiplier, range: 1.5...20, step: 0.5)
            NumberStepper(title: L("Video için en az", "Video minimum"), suffix: L("izl./sa", "views/h"), value: cfg.alerts.videoMinViewsPerHour, range: 5...100_000, step: 10)
            NumberStepper(title: L("Kanal için en az", "Channel minimum"), suffix: L("izl./sa", "views/h"), value: cfg.alerts.channelMinViewsPerHour, range: 10...1_000_000, step: 50)
            NumberStepper(title: L("Abone yağması", "Subscriber burst"), suffix: L("abone/sa", "subs/h"), value: cfg.alerts.subsPerHour, range: 1...10_000, step: 5)
            NumberStepper(title: L("Tekrar bekleme", "Cooldown"), suffix: L("saat", "hours"), value: cfg.alerts.cooldownHours, range: 0.5...48, step: 0.5)
            Toggle(isOn: cfg.alerts.newVideo) {
                Text(L("Yeni video bildirimi", "New video alerts")).font(.subheadline).foregroundStyle(Theme.text)
            }
            .tint(Theme.toggle)
            Text(L("Hedefler: ", "Milestones: ") + cfg.wrappedValue.milestones.map { Fmt.compact($0) }.joined(separator: " · "))
                .font(.caption).foregroundStyle(Theme.muted)
            HStack(spacing: 8) {
                SecondaryButton(title: L("Test bildirimi", "Test alert")) {
                    Task { await run { try await model.sendTest(); return L("Test bildirimi gönderildi.", "Test notification sent.") } }
                }
                SecondaryButton(title: L("Şimdi yenile", "Refresh now")) {
                    Task { await run { try await model.refreshNow(); return L("Kanallar güncellendi.", "Channels updated.") } }
                }
            }
        }
        .panel()
    }

    // MARK: Sabah özeti

    private func morningSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("Sabah özeti", "Morning summary")).label()
            Text(L("Belli bir saat yok: özet, alarmını kapattığında (ya da uyku modu bittiğinde) gelir. Bir kez kurman yeterli:",
                   "No fixed time: the summary arrives when you stop your alarm (or wake up from Sleep Focus). Set it up once:"))
                .font(.subheadline).foregroundStyle(Theme.text)
            VStack(alignment: .leading, spacing: 6) {
                Step(n: 1, text: L("Kısayollar → Otomasyon → + → **Alarm** (veya **Uyku → Uyanış**)", "Shortcuts → Automation → + → **Alarm** (or **Sleep → Wake Up**)"))
                Step(n: 2, text: L("**Durdurulduğunda** → **Hemen Çalıştır**", "**Is Stopped** → **Run Immediately**"))
                Step(n: 3, text: L("Eylem: **Kanal Takip → Sabah Özeti**", "Action: **Kanal Takip → Morning Summary**"))
            }
            SecondaryButton(title: L("Kısayollar'ı aç", "Open Shortcuts")) { if let u = URL(string: "shortcuts://") { openURL(u) } }
            Text(.init(L("Kilit ekranına **Kanal Takip** widget'ını eklersen telefonu eline aldığın an son 24 saati görürsün.",
                         "Add the **Kanal Takip** widget to your Lock Screen to see the last 24 hours at a glance.")))
                .font(.footnote).foregroundStyle(Theme.muted)

            Rectangle().fill(Theme.line).frame(height: 1)
            Toggle(isOn: Binding(
                get: { cfg.wrappedValue.morningFallbackHour != nil },
                set: { cfg.wrappedValue.morningFallbackHour = $0 ? 11 : nil }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Yedek özet", "Backup summary")).font(.subheadline).foregroundStyle(Theme.text)
                    Text(L("Otomasyon o gün çalışmazsa bu saatte gönderilir", "Sent at this time if the automation didn't run"))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .tint(Theme.toggle)
            if let hour = cfg.wrappedValue.morningFallbackHour {
                Stepper(value: Binding(get: { hour }, set: { cfg.wrappedValue.morningFallbackHour = $0 }), in: 5...14) {
                    Text(L("En geç \(String(format: "%02d:00", hour))", "No later than \(String(format: "%02d:00", hour))"))
                        .font(.subheadline.monospacedDigit()).foregroundStyle(Theme.text)
                }
            }
        }
        .panel()
    }

    // MARK: Hakkında

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("Hakkında", "About")).label()
            LinkRow(title: L("Gizlilik politikası", "Privacy policy"), url: Links.privacy)
            LinkRow(title: L("Destek", "Support"), url: Links.support)
            LinkRow(title: L("YouTube Hizmet Şartları", "YouTube Terms of Service"), url: Links.youtubeTerms)
            LinkRow(title: L("Google Gizlilik Politikası", "Google Privacy Policy"), url: Links.googlePrivacy)
            Text(L("Kanal verileri YouTube API Hizmetleri ile alınır. Kanal Takip, YouTube veya Google ile bağlantılı değildir.",
                   "Channel data is provided by YouTube API Services. Kanal Takip is not affiliated with YouTube or Google."))
                .font(.caption).foregroundStyle(Theme.muted)
            Text(appVersion).font(.caption2.monospacedDigit()).foregroundStyle(Theme.muted)

            Rectangle().fill(Theme.line).frame(height: 1)
            SecondaryButton(title: L("Verilerimi sil", "Delete my data"), color: Theme.down) { confirmDelete = true }
                .confirmationDialog(L("Tüm verilerin silinsin mi?", "Delete all your data?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button(L("Sil", "Delete"), role: .destructive) {
                        Task { await run { try await model.deleteAccount(); return L("Verilerin silindi.", "Your data was deleted.") } }
                    }
                } message: {
                    Text(L("Kanal listen, ayarların, bildirim geçmişin ve cihaz kaydın sunucudan kalıcı olarak silinir.",
                           "Your channel list, settings, notification history and device registration will be permanently deleted from the server."))
                }
        }
        .panel()
    }

    private var appVersion: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "Kanal Takip \(v) (\(b))"
    }

    // MARK: Eylemler

    private func save() async {
        guard let draft else { return }
        await run {
            try await model.saveConfig(draft)
            return L("Kaydedildi.", "Saved.")
        }
        if message?.1 == true { self.draft = nil }
    }

    private func run(_ op: () async throws -> String) async {
        busy = true
        defer { busy = false }
        do { message = (try await op(), true) } catch { message = (error.localizedDescription, false) }
    }
}

private struct LinkRow: View {
    @Environment(\.openURL) private var openURL
    let title: String
    let url: URL

    var body: some View {
        Button { openURL(url) } label: {
            HStack {
                Text(title).font(.subheadline).foregroundStyle(Theme.text)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct NumberStepper: View {
    let title: String
    let suffix: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double

    var body: some View {
        Stepper(value: $value, in: range, step: step) {
            HStack(spacing: 6) {
                Text(title).font(.subheadline).foregroundStyle(Theme.text)
                Spacer()
                Text(value.truncatingRemainder(dividingBy: 1) == 0 ? Fmt.number(Int(value)) : String(format: "%.1f", value))
                    .font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(Theme.text)
                Text(suffix).font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}

private struct Step: View {
    let n: Int
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.system(size: 11, weight: .heavy).monospacedDigit())
                .frame(width: 20, height: 20).foregroundStyle(Theme.bg).background(Theme.text)
            Text(.init(text)).font(.footnote).foregroundStyle(Theme.text)
        }
    }
}
