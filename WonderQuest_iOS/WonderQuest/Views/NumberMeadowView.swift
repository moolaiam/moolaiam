import SwiftUI

struct NumberMeadowView: View {
    @EnvironmentObject var gameState: GameState

    struct Apple: Identifiable {
        let id: Int
        var picked = false
    }

    static let targets = [5, 3, 7, 4, 6]
    static let appleCount = 8

    @State private var challengeIndex = 0
    @State private var basket = 0
    @State private var apples = NumberMeadowView.freshApples()

    private var target: Int {
        NumberMeadowView.targets[challengeIndex]
    }

    private static func freshApples() -> [Apple] {
        (0..<appleCount).map { Apple(id: $0) }
    }

    var body: some View {
        VStack(spacing: 16) {
            header
            numberLine
            appleTree
            Spacer()
        }
        .padding(.top)
    }

    private var header: some View {
        HStack {
            Text("🍎")
                .font(.system(size: 32))
                .padding(8)
                .background(Color.green.opacity(0.2))
                .clipShape(RoundedRectangle(cornerRadius: 14))

            VStack(alignment: .leading, spacing: 2) {
                Text("NUMBER CHALLENGE")
                    .font(.caption2)
                    .fontWeight(.black)
                    .foregroundColor(.green)
                Text("Pick \(target) apples into Barnaby's basket!")
                    .font(.system(.subheadline, design: .rounded))
                    .fontWeight(.bold)
            }

            Spacer()

            Button(action: {
                SoundManager.shared.speak("Pick \(target) apples")
            }) {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundColor(.green)
            }
            .accessibilityLabel("Hear the challenge")

            Text("\(basket) / \(target)")
                .font(.headline)
                .foregroundColor(.green)
        }
        .padding()
        .background(Color.green.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal)
    }

    /// Number line 1–8. Numbers up to the basket count light up as apples are picked.
    private var numberLine: some View {
        HStack(spacing: 6) {
            ForEach(1...NumberMeadowView.appleCount, id: \.self) { number in
                Text("\(number)")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .frame(width: 30, height: 30)
                    .background(number <= basket ? Color.green : Color(UIColor.secondarySystemBackground))
                    .foregroundColor(number <= basket ? .white : .secondary)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(number == target ? Color.orange : .clear, lineWidth: 3)
                    )
            }
        }
        .padding(.horizontal)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: basket)
    }

    private var appleTree: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28)
                .fill(LinearGradient(colors: [Color.green.opacity(0.3), Color.yellow.opacity(0.2)], startPoint: .top, endPoint: .bottom))

            VStack {
                ZStack {
                    Circle()
                        .fill(LinearGradient(colors: [.green, Color(red: 0.2, green: 0.6, blue: 0.3)], startPoint: .top, endPoint: .bottom))
                        .frame(width: 280, height: 190)

                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(48)), count: 4), spacing: 14) {
                        ForEach(apples) { apple in
                            Button(action: { pick(apple) }) {
                                Text("🍎")
                                    .font(.system(size: 36))
                                    .shadow(radius: 2)
                            }
                            .buttonStyle(.plain)
                            .opacity(apple.picked ? 0 : 1)
                            .scaleEffect(apple.picked ? 0.4 : 1)
                            .disabled(apple.picked)
                            .animation(.easeOut(duration: 0.2), value: apple.picked)
                        }
                    }
                }
                .padding(.top, 20)

                Spacer()

                HStack(spacing: 12) {
                    Text("🐻")
                        .font(.system(size: 40))

                    ZStack {
                        RoundedRectangle(cornerRadius: 18)
                            .fill(Color.brown)
                            .frame(width: 130, height: 70)
                        VStack(spacing: 2) {
                            Text("🧺 Basket")
                                .font(.caption)
                                .fontWeight(.black)
                                .foregroundColor(.white)
                            Text("\(basket) Apples")
                                .font(.headline)
                                .fontWeight(.bold)
                                .foregroundColor(.yellow)
                        }
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .padding(.horizontal)
    }

    private func pick(_ apple: Apple) {
        guard let index = apples.firstIndex(where: { $0.id == apple.id }),
              !apples[index].picked else { return }

        apples[index].picked = true
        basket += 1
        gameState.applesHarvested += 1
        SoundManager.shared.playTone(260 + Double(basket) * 50, duration: 0.25)
        SoundManager.shared.speak("\(basket)!")

        if basket >= target {
            gameState.reward(title: "Super Harvester!",
                             message: "You collected all \(target) juicy apples!",
                             ticketsCount: 20)
            nextChallenge()
        }
    }

    private func nextChallenge() {
        challengeIndex = (challengeIndex + 1) % NumberMeadowView.targets.count
        basket = 0
        apples = NumberMeadowView.freshApples()
    }
}
