import SwiftUI

struct StoryAndMusicView: View {
    @State private var section: Section = .story
    @State private var pageIndex = 0
    @State private var highlightedWord: Int?
    @State private var litNote: Int?

    enum Section: String, CaseIterable, Identifiable {
        case story = "📖 Storybook"
        case music = "🎹 Xylophone"

        var id: String { rawValue }
    }

    struct StoryPage {
        let scene: String
        let text: String
    }

    struct Note: Identifiable {
        let id: Int
        let name: String
        let solfege: String
        let frequency: Double
        let color: Color
    }

    static let pages: [StoryPage] = [
        StoryPage(scene: "🐻 🧭 ⛵",
                  text: "Barnaby the bear put on his explorer hat and set sail across WonderQuest Island to find the magical Golden Star."),
        StoryPage(scene: "🐬 🐸 🐦 🌈",
                  text: "Along the rainbow path, Barnaby met playful dolphins, counting frogs, and singing birds that loved phonics rhymes."),
        StoryPage(scene: "⭐ 🎉 🌟",
                  text: "With bright teamwork and lots of fun learning, Barnaby found the Golden Star shining bright for every child to share!")
    ]

    /// Seven notes, one octave from C to B.
    static let notes: [Note] = [
        Note(id: 0, name: "C", solfege: "Do", frequency: 261.63, color: .red),
        Note(id: 1, name: "D", solfege: "Re", frequency: 293.66, color: .orange),
        Note(id: 2, name: "E", solfege: "Mi", frequency: 329.63, color: .yellow),
        Note(id: 3, name: "F", solfege: "Fa", frequency: 349.23, color: .green),
        Note(id: 4, name: "G", solfege: "So", frequency: 392.00, color: .blue),
        Note(id: 5, name: "A", solfege: "La", frequency: 440.00, color: .indigo),
        Note(id: 6, name: "B", solfege: "Ti", frequency: 493.88, color: .purple)
    ]

    /// Note indexes for "Twinkle, Twinkle, Little Star".
    static let twinkleMelody = [0, 0, 4, 4, 5, 5, 4]

    /// Time between words during read-along, in seconds.
    private let secondsPerWord = 0.3

    var body: some View {
        VStack(spacing: 16) {
            Picker("Section", selection: $section) {
                ForEach(Section.allCases) { option in
                    Text(option.rawValue).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            switch section {
            case .story: storybook
            case .music: xylophone
            }

            Spacer()
        }
        .padding(.top)
    }

    // MARK: - Storybook

    private var storybook: some View {
        let page = StoryAndMusicView.pages[pageIndex]
        let words = page.text.split(separator: " ").map(String.init)

        return VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 24)
                    .fill(LinearGradient(colors: [.yellow.opacity(0.3), .orange.opacity(0.2)], startPoint: .top, endPoint: .bottom))
                    .frame(height: 170)

                VStack(spacing: 6) {
                    Text(page.scene)
                        .font(.system(size: 46))
                    Text("Barnaby's Adventure • Page \(pageIndex + 1) of \(StoryAndMusicView.pages.count)")
                        .font(.system(.caption, design: .rounded))
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                }
            }

            highlightedText(words)
                .font(.system(.body, design: .rounded))
                .lineSpacing(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color(UIColor.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 18))

            HStack(spacing: 12) {
                Button(action: { turnPage(by: -1) }) {
                    Image(systemName: "chevron.left.circle.fill")
                        .font(.title)
                }
                .disabled(pageIndex == 0)
                .accessibilityLabel("Previous page")

                Button(action: { readAloud(words) }) {
                    Label("Read to Me", systemImage: "play.circle.fill")
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(Color.orange)
                        .clipShape(Capsule())
                }

                Button(action: { turnPage(by: 1) }) {
                    Image(systemName: "chevron.right.circle.fill")
                        .font(.title)
                }
                .disabled(pageIndex == StoryAndMusicView.pages.count - 1)
                .accessibilityLabel("Next page")
            }
        }
        .padding(.horizontal)
    }

    /// Words are drawn as one Text so each one can be colored as it is read aloud.
    private func highlightedText(_ words: [String]) -> Text {
        words.enumerated().reduce(Text("")) { result, item in
            let color: Color = item.offset == highlightedWord ? .orange : .primary
            return result + Text(item.element + " ").foregroundColor(color).bold()
        }
    }

    private func turnPage(by offset: Int) {
        let next = pageIndex + offset
        guard StoryAndMusicView.pages.indices.contains(next) else { return }
        pageIndex = next
        highlightedWord = nil
        SoundManager.shared.playPop()
    }

    private func readAloud(_ words: [String]) {
        SoundManager.shared.speak(words.joined(separator: " "))
        highlightedWord = nil
        for index in words.indices {
            DispatchQueue.main.asyncAfter(deadline: .now() + secondsPerWord * Double(index)) {
                highlightedWord = index
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + secondsPerWord * Double(words.count)) {
            highlightedWord = nil
        }
    }

    // MARK: - Xylophone

    private var xylophone: some View {
        VStack(spacing: 14) {
            Text("🎵 Tap the keys to play music!")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(alignment: .bottom, spacing: 6) {
                ForEach(StoryAndMusicView.notes) { note in
                    Button(action: { play(note) }) {
                        VStack {
                            Spacer()
                            Text(note.name)
                                .font(.headline)
                                .fontWeight(.black)
                                .foregroundColor(.white)
                            Text(note.solfege)
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.85))
                                .padding(.bottom, 8)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: CGFloat(180 - note.id * 12))
                        .background(note.color)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .shadow(radius: 2)
                        .scaleEffect(litNote == note.id ? 0.95 : 1)
                        .brightness(litNote == note.id ? 0.15 : 0)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
            .background(Color(UIColor.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .padding(.horizontal)

            Button(action: playTwinkle) {
                Label("Play Twinkle, Twinkle", systemImage: "music.note")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Color.purple)
                    .clipShape(Capsule())
            }
            .padding(.top, 4)
        }
    }

    private func play(_ note: Note) {
        SoundManager.shared.playTone(note.frequency)
        litNote = note.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            if litNote == note.id { litNote = nil }
        }
    }

    private func playTwinkle() {
        for (step, index) in StoryAndMusicView.twinkleMelody.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45 * Double(step)) {
                play(StoryAndMusicView.notes[index])
            }
        }
    }
}
