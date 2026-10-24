import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var draft: AppConfig?
    @State private var newChannel = ""
    @State private var busy = false
    @State private var message: (String, Bool)?
    @State private var confirmDisconnect = false

    var body: some View {
        NavigationStack {
            Screen(title: "Ayarlar", large: true) {
                if let message {
                    Text(message.0).font(.footnote.weight(.semibold))
                        .foregroundStyle(message.1 ? Theme.up : Theme.down)
                        .panel(padding: 12)
                }

                if let binding = Binding($draft) {
                    channelsSection(binding)
                    alertsSection(binding)
                    morningSection(binding)
                    PrimaryButton(title: busy ? "Kaydediliyor…" : "Ayarları kaydet", disabled: busy || draft == model.config) {
                        Task { await save() }
                    }
                } else {
                    Text("Ayarlar yükleniyor…").font(.footnote).foregroundStyle(Theme.muted).panel()
                }

                serverSection
            }
            .onAppear { if draft == nil { draft = model.config } }
            // Kaydedilmemiş değişiklik yoksa sunucudaki son hâli göster
            .onChange(of: model.config) { old, new in if draft == nil || draft == old { draft = new } }
        }
    }

    // MARK: Kanallar

    private func channelsSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Kanallar · \(cfg.wrappedValue.channels.count)").label()
            ForEach(cfg.wrappedValue.channels, id: \.self) { ch in
                HStack {
                    Text(displayName(for: ch)).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                    Spacer()
                    Button {
                        cfg.wrappedValue.channels.removeAll { $0 == ch }
                    } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                            .frame(width: 28, height: 28)
                    }
                    .accessibilityLabel("Kaldır")
                }
                .padding(.vertical, 2)
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            HStack(spacing: 8) {
                TextField("@kanaladi veya link", text: $newChannel)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.system(size: 15, design: .monospaced))
                    .padding(10).background(Theme.bg)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
                    .onSubmit { addChannel(cfg) }
                Button { addChannel(cfg) } label: {
                    Image(systemName: "plus").font(.system(size: 15, weight: .heavy))
                        .frame(width: 42, height: 42).foregroundStyle(Theme.bg).background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .disabled(newChannel.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .panel()
    }

    private func displayName(for ref: String) -> String {
        // Çözülmüş kanal adını göster (varsa)
        let lower = ref.lowercased()
        if let c = model.state?.orderedChannels.first(where: { ref.contains($0.id) || ($0.handle?.lowercased()).map { lower.hasSuffix($0) } == true }) {
            return "\(c.title)  ·  \(ref)"
        }
        return ref
    }

    private func addChannel(_ cfg: Binding<AppConfig>) {
        let v = newChannel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, !cfg.wrappedValue.channels.contains(v) else { return }
        cfg.wrappedValue.channels.append(v)
        newChannel = ""
    }

    // MARK: Bildirim eşikleri

    private func alertsSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Bildirimler").label()
            NumberStepper(title: "Sıçrama eşiği", suffix: "× normal", value: cfg.alerts.spikeMultiplier, range: 1.5...20, step: 0.5)
            NumberStepper(title: "Video için en az", suffix: "izl./saat", value: cfg.alerts.videoMinViewsPerHour, range: 5...100_000, step: 10)
            NumberStepper(title: "Kanal için en az", suffix: "izl./saat", value: cfg.alerts.channelMinViewsPerHour, range: 10...1_000_000, step: 50)
            NumberStepper(title: "Abone yağması", suffix: "abone/saat", value: cfg.alerts.subsPerHour, range: 1...10_000, step: 5)
            NumberStepper(title: "Tekrar bekleme", suffix: "saat", value: cfg.alerts.cooldownHours, range: 0.5...48, step: 0.5)
            Toggle(isOn: cfg.alerts.newVideo) {
                Text("Yeni video bildirimi").font(.subheadline).foregroundStyle(Theme.text)
            }
            .tint(Theme.toggle)
            Text("Hedefler: " + cfg.wrappedValue.milestones.map { Fmt.compact($0) }.joined(separator: " · "))
                .font(.caption).foregroundStyle(Theme.muted)
            HStack(spacing: 8) {
                SecondaryButton(title: "Test bildirimi") { Task { await run { try await model.sendTest(); return "Test bildirimi gönderildi." } } }
                SecondaryButton(title: "Şimdi kontrol et") { Task { await run { try await model.runNow(); return "Kanallar kontrol edildi." } } }
            }
        }
        .panel()
    }

    // MARK: Sabah özeti

    private func morningSection(_ cfg: Binding<AppConfig>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sabah özeti").label()
            Text("Belli bir saat yok: özet, alarmını kapattığında (ya da uyku modu bittiğinde) gelir. Bir kez kurman yeterli:")
                .font(.subheadline).foregroundStyle(Theme.text)
            VStack(alignment: .leading, spacing: 6) {
                Step(n: 1, text: "Kısayollar → Otomasyon → + → **Alarm** (veya **Uyku → Uyanış**)")
                Step(n: 2, text: "**Durdurulduğunda** → **Hemen Çalıştır**")
                Step(n: 3, text: "Eylem: **Kanal Takip → Sabah Özeti**")
            }
            SecondaryButton(title: "Kısayollar'ı aç") { if let u = URL(string: "shortcuts://") { openURL(u) } }
            Text("Kilit ekranına **Kanal Takip** widget'ını eklersen telefonu eline aldığın an son 24 saati görürsün.")
                .font(.footnote).foregroundStyle(Theme.muted)

            Rectangle().fill(Theme.line).frame(height: 1)
            Toggle(isOn: Binding(
                get: { cfg.wrappedValue.morningFallbackHour != nil },
                set: { cfg.wrappedValue.morningFallbackHour = $0 ? 11 : nil }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Yedek özet").font(.subheadline).foregroundStyle(Theme.text)
                    Text("Otomasyon o gün çalışmazsa sunucu gönderir").font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .tint(Theme.toggle)
            if let hour = cfg.wrappedValue.morningFallbackHour {
                Stepper(value: Binding(get: { hour }, set: { cfg.wrappedValue.morningFallbackHour = $0 }), in: 5...14) {
                    Text("En geç \(String(format: "%02d:00", hour))").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.text)
                }
            }
        }
        .panel()
    }

    // MARK: Sunucu

    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sunucu").label()
            Text(model.server?.url.host() ?? "—").font(.system(size: 14, design: .monospaced)).foregroundStyle(Theme.text)
            HStack(spacing: 14) {
                StatusDot(on: model.state?.push == true, text: "Push")
                StatusDot(on: (model.state?.devices ?? 0) > 0, text: "\(model.state?.devices ?? 0) cihaz")
                StatusDot(on: model.state?.error == nil, text: "YouTube")
            }
            Text("Son kontrol: \(Fmt.ago(model.state?.updatedDate))").font(.caption).foregroundStyle(Theme.muted)
            SecondaryButton(title: "Bağlantıyı kaldır") { confirmDisconnect = true }
                .confirmationDialog("Sunucu bağlantısı kaldırılsın mı?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                    Button("Kaldır", role: .destructive) { model.disconnect() }
                }
        }
        .panel()
    }

    // MARK: Eylemler

    private func save() async {
        guard let draft else { return }
        await run {
            try await model.saveConfig(draft)
            return "Kaydedildi."
        }
        self.draft = model.config
    }

    private func run(_ op: () async throws -> String) async {
        busy = true
        defer { busy = false }
        do { message = (try await op(), true) } catch { message = (error.localizedDescription, false) }
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
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.system(size: 11, weight: .heavy).monospacedDigit())
                .frame(width: 20, height: 20).foregroundStyle(Theme.bg).background(Theme.text)
            Text(text).font(.footnote).foregroundStyle(Theme.text)
        }
    }
}

private struct StatusDot: View {
    let on: Bool
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Rectangle().fill(on ? Theme.up : Theme.down).frame(width: 7, height: 7)
            Text(text).font(.caption.weight(.semibold)).foregroundStyle(Theme.text)
        }
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .heavy)).tracking(1)
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .foregroundStyle(Theme.text)
                .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
