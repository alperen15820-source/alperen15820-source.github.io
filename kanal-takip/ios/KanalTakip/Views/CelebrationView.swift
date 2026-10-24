import SwiftUI

/// Abone hedefi kutlaması: siyah ekran, büyük sayı, konfeti.
struct CelebrationView: View {
    let event: AppEvent
    let onClose: () -> Void
    @State private var appeared = false
    @State private var start = Date()

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ConfettiView(start: start).ignoresSafeArea().allowsHitTesting(false)
            VStack(spacing: 18) {
                Spacer()
                Image(systemName: "trophy.fill").font(.system(size: 44)).foregroundStyle(Theme.gold)
                Text(Fmt.number(event.milestone))
                    .font(.system(size: 96, weight: .black).monospacedDigit())
                    .foregroundStyle(Theme.text)
                    .minimumScaleFactor(0.4).lineLimit(1)
                    .scaleEffect(appeared ? 1 : 0.6)
                Text("ABONE").font(.system(size: 16, weight: .heavy)).tracking(6).foregroundStyle(Theme.gold)
                if let ch = event.channel {
                    Text(ch).font(.headline).foregroundStyle(Theme.text)
                }
                Text(event.body)
                    .font(.subheadline).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center).padding(.horizontal, 24)
                Spacer()
                PrimaryButton(title: "Devam", style: Theme.accent, action: onClose)
                    .padding(.horizontal, 24).padding(.bottom, 24)
            }
            .padding()
        }
        .onAppear {
            start = Date()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            withAnimation(.spring(response: 0.5, dampingFraction: 0.55)) { appeared = true }
        }
    }
}

private struct ConfettiView: View {
    let start: Date

    private struct Piece {
        let x: Double, vx: Double, vy: Double, size: Double, spin: Double, color: Color
    }

    @State private var pieces: [Piece] = (0..<140).map { _ in
        Piece(x: .random(in: 0.3...0.7), vx: .random(in: -0.45...0.45), vy: .random(in: -1.3 ... -0.6),
              size: .random(in: 5...10), spin: .random(in: -8...8),
              color: [Color.white, Color(white: 0.75), Color(white: 0.45)].randomElement()!)
    }

    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSince(start)
                guard t < 6 else { return }
                for p in pieces {
                    let x = (p.x + p.vx * t) * size.width
                    let y = size.height * 0.4 + (p.vy * t + 0.55 * t * t) * size.height
                    guard y < size.height + 20 else { continue }
                    var c = ctx
                    c.translateBy(x: x, y: y)
                    c.rotate(by: .radians(p.spin * t))
                    c.opacity = max(0, 1 - t / 6)
                    c.fill(Path(CGRect(x: -p.size / 2, y: -p.size / 4, width: p.size, height: p.size / 2)), with: .color(p.color))
                }
            }
        }
    }
}
