import SwiftUI

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
            Text(title.uppercased(with: Lang.locale))
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

struct SecondaryButton: View {
    let title: String
    var color: Color = Theme.text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title.uppercased(with: Lang.locale))
                .font(.system(size: 11, weight: .heavy)).tracking(1)
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .foregroundStyle(color)
                .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// Kanal ekleme alanı + liste (karşılama ve ayarlar ekranında ortak).
struct ChannelListEditor: View {
    @Binding var channels: [String]
    let max: Int
    var names: (String) -> String = { $0 }
    @State private var newChannel = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(channels, id: \.self) { ch in
                HStack {
                    Text(names(ch)).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                    Spacer()
                    Button {
                        channels.removeAll { $0 == ch }
                    } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                            .frame(width: 28, height: 28)
                    }
                    .accessibilityLabel(L("Kaldır", "Remove"))
                }
                .padding(.vertical, 2)
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            if channels.count < max {
                HStack(spacing: 8) {
                    TextField(L("@kanaladi veya link", "@handle or link"), text: $newChannel)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.system(size: 15, design: .monospaced))
                        .padding(10).background(Theme.bg)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
                        .onSubmit(add)
                    Button(action: add) {
                        Image(systemName: "plus").font(.system(size: 15, weight: .heavy))
                            .frame(width: 42, height: 42).foregroundStyle(Theme.bg).background(Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                    .accessibilityLabel(L("Ekle", "Add"))
                    .disabled(newChannel.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                Text(L("En fazla \(max) kanal ekleyebilirsin.", "You can add up to \(max) channels."))
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }

    private func add() {
        let v = newChannel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, !channels.contains(v), channels.count < max else { return }
        channels.append(v)
        newChannel = ""
    }
}
