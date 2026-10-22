import SwiftUI

struct PhonicsSafariView: View {
    @EnvironmentObject var gameState: GameState

    @State private var mode: Mode = .balloons
    @State private var challengeIndex = 0
    @State private var balloons: [Balloon] = []
    @State private var poppedCount = 0
    @State private var traceIndex = 0
    @State private var strokes: [[CGPoint]] = []
    @State private var currentStroke: [CGPoint] = []

    enum Mode: String, CaseIterable, Identifiable {
        case balloons = "Balloons"
        case trace = "Trace"
        case board = "A–Z"

        var id: String { rawValue }
    }

    struct Challenge {
        let letter: String
        let word: String
        let sound: String
        let color: Color
    }

    struct Balloon: Identifiable {
        let id = UUID()
        let letter: String
        let color: Color
        var popped = false
    }

    struct LetterWord: Identifiable {
        let letter: String
        let word: String
        var id: String { letter }
    }

    static let challenges: [Challenge] = [
        Challenge(letter: "B", word: "Bear", sound: "Buh", color: .pink),
        Challenge(letter: "A", word: "Apple", sound: "Ah", color: .green),
        Challenge(letter: "S", word: "Star", sound: "Sss", color: .yellow),
        Challenge(letter: "D", word: "Dolphin", sound: "Duh", color: .blue),
        Challenge(letter: "M", word: "Music", sound: "Mmm", color: .purple)
    ]

    static let traceLetters = ["A", "B", "C", "D", "E", "S"]

    static let alphabet: [LetterWord] = makeAlphabet()

    private static func makeAlphabet() -> [LetterWord] {
        let pairs: [(String, String)] = [
            ("A", "Apple"), ("B", "Bear"), ("C", "Cat"), ("D", "Duck"), ("E", "Elephant"),
            ("F", "Fish"), ("G", "Giraffe"), ("H", "Horse"), ("I", "Iguana"), ("J", "Jelly"),
            ("K", "Kangaroo"), ("L", "Lion"), ("M", "Monkey"), ("N", "Nest"), ("O", "Owl"),
            ("P", "Panda"), ("Q", "Queen"), ("R", "Rabbit"), ("S", "Sun"), ("T", "Tiger"),
            ("U", "Umbrella"), ("V", "Violin"), ("W", "Whale"), ("X", "Xylophone"), ("Y", "Yak"),
            ("Z", "Zebra")
        ]
        return pairs.map { LetterWord(letter: $0.0, word: $0.1) }
    }

    private let goal = 5

    private var challenge: Challenge {
        PhonicsSafariView.challenges[challengeIndex]
    }

    var body: some View {
        VStack(spacing: 16) {
            Picker("Activity", selection: $mode) {
                ForEach(Mode.allCases) { option in
                    Text(option.rawValue).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            switch mode {
            case .balloons: balloonGame
            case .trace: traceGame
            case .board: soundBoard
            }
        }
        .padding(.top)
        .onAppear(perform: startIfNeeded)
    }

    // MARK: - Balloon pop

    private var balloonGame: some View {
        VStack(spacing: 16) {
            HStack {
                Button(action: {
                    SoundManager.shared.speak("Find the letter \(challenge.letter). \(challenge.sound) as in \(challenge.word)")
                }) {
                    Image(systemName: "speaker.wave.3.fill")
                        .font(.title2)
                        .foregroundColor(.white)
                        .padding(12)
                        .background(Color.pink)
                        .clipShape(Circle())
                }
                .accessibilityLabel("Hear the letter sound")

                VStack(alignment: .leading, spacing: 2) {
                    Text("PHONICS MISSION")
                        .font(.caption2)
                        .fontWeight(.black)
                        .foregroundColor(.pink)
                    Text("Pop the letter \(challenge.letter) (\"\(challenge.sound)\" as in \(challenge.word))")
                        .font(.system(.subheadline, design: .rounded))
                        .fontWeight(.bold)
                }

                Spacer()

                Text("\(poppedCount) / \(goal)")
                    .font(.headline)
                    .foregroundColor(.pink)
            }
            .padding()
            .background(Color.pink.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal)

            ZStack {
                RoundedRectangle(cornerRadius: 28)
                    .fill(LinearGradient(colors: [Color.blue.opacity(0.15), Color.pink.opacity(0.1)], startPoint: .top, endPoint: .bottom))

                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 20) {
                    ForEach(balloons) { balloon in
                        Button(action: { tap(balloon) }) {
                            balloonView(balloon)
                        }
                        .buttonStyle(.plain)
                        .disabled(balloon.popped)
                        .opacity(balloon.popped ? 0 : 1)
                        .scaleEffect(balloon.popped ? 1.5 : 1)
                        .animation(.easeOut(duration: 0.25), value: balloon.popped)
                    }
                }
                .padding()
            }
            .padding(.horizontal)

            Spacer()
        }
    }

    private func balloonView(_ balloon: Balloon) -> some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(balloon.color)
                    .frame(width: 75, height: 85)
                    .shadow(radius: 4)
                Text(balloon.letter)
                    .font(.system(size: 36, weight: .black, design: .rounded))
                    .foregroundColor(.white)
            }
            Rectangle()
                .fill(Color.gray.opacity(0.6))
                .frame(width: 2, height: 16)
        }
    }

    private func tap(_ balloon: Balloon) {
        guard let index = balloons.firstIndex(where: { $0.id == balloon.id }),
              !balloons[index].popped else { return }

        gameState.phonicsAttempts += 1
        let current = challenge

        if balloon.letter == current.letter {
            gameState.phonicsCorrect += 1
            balloons[index].popped = true
            poppedCount += 1
            SoundManager.shared.playPop()
            SoundManager.shared.speak("\(balloon.letter)! \(current.word)!")

            if poppedCount >= goal {
                gameState.reward(title: "Safari Explorer!",
                                 message: "You mastered the \(current.sound) sound with Barnaby!",
                                 ticketsCount: 25)
                nextChallenge()
            }
        } else {
            SoundManager.shared.playWrong()
            SoundManager.shared.speak("Try again! Find letter \(current.letter)")
        }
    }

    private func nextChallenge() {
        challengeIndex = (challengeIndex + 1) % PhonicsSafariView.challenges.count
        poppedCount = 0
        loadBalloons()
    }

    /// Five balloons of the target letter plus three distractors, shuffled.
    private func loadBalloons() {
        let current = challenge
        let distractors = ["C", "T", "P", "R", "K", "L", "O"]
            .filter { $0 != current.letter }
            .shuffled()
            .prefix(3)
        let letters = (Array(repeating: current.letter, count: goal) + Array(distractors)).shuffled()
        let colors: [Color] = [.pink, .orange, .blue, .green, .purple, .red, .teal, .indigo]
        balloons = letters.enumerated().map { index, letter in
            Balloon(letter: letter, color: colors[index % colors.count])
        }
    }

    private func startIfNeeded() {
        guard balloons.isEmpty else { return }
        loadBalloons()
        SoundManager.shared.speak("Welcome to Phonics Safari! Pop the letter \(challenge.letter) balloons!")
    }

    // MARK: - Letter trace

    private var traceGame: some View {
        let letter = PhonicsSafariView.traceLetters[traceIndex]
        return VStack(spacing: 16) {
            Text("Trace the letter \(letter)")
                .font(.system(.headline, design: .rounded))
                .fontWeight(.black)

            ZStack {
                RoundedRectangle(cornerRadius: 28)
                    .fill(Color(UIColor.systemBackground))

                Text(letter)
                    .font(.system(size: 200, weight: .black, design: .rounded))
                    .foregroundColor(Color.pink.opacity(0.15))

                Path { path in
                    for stroke in strokes + [currentStroke] where !stroke.isEmpty {
                        path.move(to: stroke[0])
                        for point in stroke.dropFirst() {
                            path.addLine(to: point)
                        }
                    }
                }
                .stroke(Color.pink, style: StrokeStyle(lineWidth: 14, lineCap: .round, lineJoin: .round))
            }
            .frame(height: 320)
            .padding(.horizontal)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        currentStroke.append(value.location)
                    }
                    .onEnded { _ in
                        strokes.append(currentStroke)
                        currentStroke = []
                    }
            )

            HStack(spacing: 12) {
                Button("Clear") {
                    strokes = []
                    currentStroke = []
                }
                .buttonStyle(.bordered)

                Button("Next Letter") {
                    traceIndex = (traceIndex + 1) % PhonicsSafariView.traceLetters.count
                    strokes = []
                    currentStroke = []
                    SoundManager.shared.speak("Trace the letter \(PhonicsSafariView.traceLetters[traceIndex])")
                }
                .buttonStyle(.bordered)

                Button("Done ✓") {
                    gameState.reward(title: "Beautiful Writing!",
                                     message: "You traced the letter \(letter)!",
                                     ticketsCount: 15)
                    traceIndex = (traceIndex + 1) % PhonicsSafariView.traceLetters.count
                    strokes = []
                    currentStroke = []
                }
                .buttonStyle(.borderedProminent)
                .tint(.pink)
            }

            Spacer()
        }
    }

    // MARK: - A–Z sound board

    private var soundBoard: some View {
        ScrollView(showsIndicators: false) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 10) {
                ForEach(PhonicsSafariView.alphabet) { entry in
                    Button(action: {
                        SoundManager.shared.speak("\(entry.letter)! \(entry.word)!")
                    }) {
                        VStack(spacing: 2) {
                            Text(entry.letter)
                                .font(.system(.title3, design: .rounded))
                                .fontWeight(.black)
                                .foregroundColor(.pink)
                            Text(entry.word)
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color(UIColor.systemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.pink.opacity(0.3), lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
    }
}
