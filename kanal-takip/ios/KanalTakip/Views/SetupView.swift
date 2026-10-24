import SwiftUI

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var urlText = ""
    @State private var secret = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("KANAL\nTAKİP").font(.system(size: 44, weight: .black)).foregroundStyle(Theme.text)
                    Rectangle().fill(Theme.accent).frame(width: 48, height: 4)
                }
                .padding(.top, 40)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Bağlan").label()
                    Text("Bilgisayarda `npm run kurulum` komutunun sonunda çıkan QR kodu iPhone kamerasıyla okut. Ya da adresi ve anahtarı aşağıya gir.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                    Field(title: "Sunucu adresi", text: $urlText, placeholder: "https://kanal-takip.xxx.workers.dev")
                        .keyboardType(.URL)
                    Field(title: "Anahtar", text: $secret, placeholder: "APP_SECRET")
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.down) }
                    if let e = model.errorMessage { Text(e).font(.footnote).foregroundStyle(Theme.down) }
                    PrimaryButton(title: busy ? "Bağlanıyor…" : "Bağlan", disabled: busy || urlText.isEmpty || secret.isEmpty) {
                        Task { await connect() }
                    }
                }
                .panel()
            }
            .padding(16)
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    private func connect() async {
        var raw = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !raw.hasPrefix("http") { raw = "https://" + raw }
        guard let url = URL(string: raw) else { error = "Adres geçersiz"; return }
        busy = true
        defer { busy = false }
        do {
            try await model.connect(url: url, secret: secret.trimmingCharacters(in: .whitespacesAndNewlines))
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct Field: View {
    let title: String
    @Binding var text: String
    var placeholder = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).label()
            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 15, design: .monospaced))
                .padding(12)
                .background(Theme.bg)
                .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
        }
    }
}

struct PrimaryButton: View {
    let title: String
    var disabled = false
    var style: Color = Theme.accent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title.uppercased())
                .font(.system(size: 13, weight: .heavy)).tracking(1.2)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .foregroundStyle(disabled ? Theme.muted : Theme.bg)
                .background(disabled ? Theme.surface2 : style)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .disabled(disabled)
        .buttonStyle(.plain)
    }
}
