import SwiftUI

/// Opens the Parent Hub only after the grown-up solves the gate.
struct ParentHubSheet: View {
    @State private var unlocked = false

    var body: some View {
        if unlocked {
            ParentDashboardView()
        } else {
            ParentGateView { unlocked = true }
        }
    }
}

/// Math gate: a grown-up picks the right answer to an addition problem.
struct ParentGateView: View {
    @Environment(\.dismiss) private var dismiss
    let onUnlock: () -> Void

    @State private var first = 0
    @State private var second = 0
    @State private var choices: [Int] = []
    @State private var message = "Please solve this to open the Parent Hub."

    init(onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 22) {
                Text("🔒")
                    .font(.system(size: 56))

                VStack(spacing: 6) {
                    Text("Grown-Ups Only")
                        .font(.title2)
                        .fontWeight(.black)
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }

                Text("What is \(first) + \(second)?")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(UIColor.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                HStack(spacing: 14) {
                    ForEach(choices, id: \.self) { value in
                        Button(action: { check(value) }) {
                            Text("\(value)")
                                .font(.title)
                                .fontWeight(.black)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.blue.opacity(0.15))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .buttonStyle(.plain)
                    }
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Parent Gate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear(perform: newProblem)
        }
    }

    private func newProblem() {
        first = Int.random(in: 3...7)
        second = Int.random(in: 2...6)
        let answer = first + second
        choices = [answer, answer + 1, max(1, answer - 2)].shuffled()
    }

    private func check(_ value: Int) {
        if value == first + second {
            onUnlock()
        } else {
            message = "Not quite. Try a new problem!"
            SoundManager.shared.playWrong()
            newProblem()
        }
    }
}

struct ParentDashboardView: View {
    @EnvironmentObject var gameState: GameState
    @Environment(\.dismiss) private var dismiss

    private let limitOptions = [15, 30, 45, 60]

    private var collectedStickers: Int {
        GameState.stickers.filter { gameState.owns($0) }.count
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    screenTimeCard
                    analyticsCard
                    settingsCard
                    complianceCard
                }
                .padding()
            }
            .navigationTitle("Parent Hub")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var screenTimeCard: some View {
        let used = gameState.screenMinutesToday
        let limit = gameState.dailyLimitMinutes
        let overLimit = used >= limit

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Screen Time Today")
                    .font(.headline)
                Spacer()
                Text("\(used) / \(limit) min")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(overLimit ? .red : .green)
            }

            ProgressView(value: min(Double(used) / Double(limit), 1))
                .tint(overLimit ? .red : .green)

            Text("Daily limit")
                .font(.caption)
                .fontWeight(.bold)
            Picker("Daily limit", selection: $gameState.dailyLimitMinutes) {
                ForEach(limitOptions, id: \.self) { minutes in
                    Text("\(minutes) min").tag(minutes)
                }
            }
            .pickerStyle(.segmented)

            Text("Counted on this device while WonderQuest is open.")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .cardStyle()
    }

    private var analyticsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Learning Analytics")
                .font(.headline)

            StatRow(title: "🔤 Phonics accuracy",
                    value: "\(gameState.phonicsAccuracy)%",
                    fraction: Double(gameState.phonicsAccuracy) / 100,
                    color: .pink)
            StatRow(title: "🍎 Apples harvested",
                    value: "\(gameState.applesHarvested)",
                    fraction: min(Double(gameState.applesHarvested) / 20, 1),
                    color: .green)
            StatRow(title: "🧩 Puzzles solved",
                    value: "\(gameState.puzzlesSolved)",
                    fraction: min(Double(gameState.puzzlesSolved) / 5, 1),
                    color: .purple)
            StatRow(title: "⭐ Stickers collected",
                    value: "\(collectedStickers) / \(GameState.stickers.count)",
                    fraction: Double(collectedStickers) / Double(GameState.stickers.count),
                    color: .orange)
        }
        .cardStyle()
    }

    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sound & Voice")
                .font(.headline)

            Toggle("Sound effects & music", isOn: $gameState.soundEnabled)

            Text("Voice speed")
                .font(.caption)
                .fontWeight(.bold)
            Picker("Voice speed", selection: $gameState.speechRate) {
                Text("Gentle").tag(Float(0.4))
                Text("Standard").tag(Float(0.5))
            }
            .pickerStyle(.segmented)
        }
        .cardStyle()
    }

    private var complianceCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checkmark.shield.fill")
                .font(.title)
                .foregroundColor(.blue)

            VStack(alignment: .leading, spacing: 4) {
                Text("Built for the Apple Kids Category")
                    .font(.subheadline)
                    .fontWeight(.bold)
                Text("No ads, no third-party trackers, no behavioral advertising. Progress is stored only on this device, and grown-up gates guard this hub.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.blue.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

struct StatRow: View {
    let title: String
    let value: String
    let fraction: Double
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                    .font(.caption)
                    .fontWeight(.bold)
                Spacer()
                Text(value)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(color)
            }
            ProgressView(value: fraction)
                .tint(color)
        }
    }
}

extension View {
    fileprivate func cardStyle() -> some View {
        self
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(UIColor.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}
