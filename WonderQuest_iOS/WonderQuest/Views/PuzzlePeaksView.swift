import SwiftUI

struct PuzzlePeaksView: View {
    @EnvironmentObject var gameState: GameState
    @State private var placedShapes: Set<String> = []

    struct ShapeItem: Identifiable {
        let id: String
        let name: String
        let icon: String
        let color: Color
    }

    let shapes = [
        ShapeItem(id: "circle", name: "Circle", icon: "🟢", color: .green),
        ShapeItem(id: "triangle", name: "Triangle", icon: "🔺", color: .red),
        ShapeItem(id: "star", name: "Star", icon: "⭐", color: .yellow),
        ShapeItem(id: "square", name: "Square", icon: "🟦", color: .blue)
    ]

    private var solved: Bool {
        placedShapes.count == shapes.count
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("🧩 Shape Matching Puzzle")
                .font(.system(.title3, design: .rounded))
                .fontWeight(.black)

            Text("\(placedShapes.count) of \(shapes.count) placed")
                .font(.system(.subheadline, design: .rounded))
                .fontWeight(.bold)
                .foregroundColor(.purple)

            silhouetteBoard

            if solved {
                revealBanner
            }

            Text("Tap a shape to place it in its slot:")
                .font(.caption)
                .foregroundColor(.secondary)

            shapeTray

            Button("Play Again") {
                placedShapes = []
                SoundManager.shared.playPop()
            }
            .buttonStyle(.bordered)
            .tint(.purple)

            Spacer()
        }
        .padding()
    }

    private var silhouetteBoard: some View {
        HStack(spacing: 16) {
            ForEach(shapes) { shape in
                let isPlaced = placedShapes.contains(shape.id)
                VStack(spacing: 4) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18)
                            .fill(isPlaced ? shape.color.opacity(0.3) : Color.clear)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .strokeBorder(shape.color, style: StrokeStyle(lineWidth: 3, dash: [6]))
                            )
                            .frame(width: 70, height: 70)

                        Text(shape.icon)
                            .font(.system(size: isPlaced ? 36 : 28))
                            .opacity(isPlaced ? 1 : 0.25)
                    }
                    Text(shape.name)
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color.purple.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }

    private var revealBanner: some View {
        HStack(spacing: 12) {
            Text("🐬")
                .font(.system(size: 40))
            Text("Dolphin Bay unlocked!")
                .font(.system(.headline, design: .rounded))
                .fontWeight(.black)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(LinearGradient(colors: [.yellow.opacity(0.6), .orange.opacity(0.4)], startPoint: .leading, endPoint: .trailing))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .transition(.scale.combined(with: .opacity))
    }

    private var shapeTray: some View {
        HStack(spacing: 16) {
            ForEach(shapes) { shape in
                if !placedShapes.contains(shape.id) {
                    Button(action: { place(shape) }) {
                        VStack {
                            Text(shape.icon)
                                .font(.system(size: 32))
                            Text(shape.name)
                                .font(.caption2)
                                .fontWeight(.bold)
                        }
                        .frame(width: 65, height: 65)
                        .background(Color(UIColor.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .shadow(radius: 2)
                    }
                    .buttonStyle(.plain)
                } else {
                    Color.clear.frame(width: 65, height: 65)
                }
            }
        }
    }

    private func place(_ shape: ShapeItem) {
        guard !placedShapes.contains(shape.id) else { return }

        placedShapes.insert(shape.id)
        SoundManager.shared.playPop()
        SoundManager.shared.speak(shape.name)

        if solved {
            gameState.puzzlesSolved += 1
            gameState.reward(title: "Puzzle Master!",
                             message: "You matched all shapes and unlocked Dolphin Bay!",
                             ticketsCount: 25)
        }
    }
}
