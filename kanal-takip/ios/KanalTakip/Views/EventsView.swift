import SwiftUI

struct EventsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Screen(title: "Olaylar") {
                let events = model.state?.events ?? []
                if events.isEmpty {
                    Text("Henüz olay yok. Sıçramalar, yeni videolar ve abone hedefleri burada listelenir.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .panel()
                } else {
                    VStack(spacing: 0) {
                        ForEach(events) { EventRow(event: $0) }
                    }
                    .panel(padding: 14)
                }
            }
            .refreshable { await model.refresh(force: true) }
        }
    }
}

struct EventRow: View {
    @Environment(\.openURL) private var openURL
    let event: AppEvent

    private var style: (String, Color) {
        switch event.type {
        case "milestone": return ("trophy.fill", Theme.gold)
        case "spike_video": return ("flame.fill", Theme.down)
        case "spike_channel": return ("arrow.up.right", Theme.up)
        case "subs_jump": return ("person.2.fill", Theme.up)
        case "new_video": return ("play.rectangle.fill", Theme.accent)
        case "morning": return ("sun.max.fill", Theme.gold)
        default: return ("checkmark", Theme.muted)
        }
    }

    var body: some View {
        Button {
            if let s = event.url, let u = URL(string: s) { openURL(u) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: style.0)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(style.1)
                    .frame(width: 30, height: 30)
                    .background(Theme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title.withoutLeadingEmoji).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(event.body).font(.footnote).foregroundStyle(Theme.muted)
                    Text(Fmt.ago(event.date)).font(.caption2).foregroundStyle(Theme.muted.opacity(0.8))
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
