import SwiftUI

struct AdventureMapView: View {
    @EnvironmentObject var gameState: GameState
    
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                // Interactive Island Hero Card
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 28)
                        .fill(LinearGradient(colors: [Color.blue.opacity(0.4), Color.green.opacity(0.3)], startPoint: .top, endPoint: .bottom))
                        .frame(height: 220)
                        .overlay(
                            VStack {
                                HStack {
                                    Text("🌈 WonderQuest Adventure Island")
                                        .font(.system(.subheadline, design: .rounded))
                                        .fontWeight(.bold)
                                        .padding(8)
                                        .background(.ultraThinMaterial)
                                        .clipShape(Capsule())
                                    Spacer()
                                }
                                Spacer()
                                // Hotspots Row
                                HStack(spacing: 16) {
                                    HotspotButton(title: "ABC Phonics", icon: "🦁", color: .pink) {
                                        gameState.currentTab = .phonics
                                    }
                                    HotspotButton(title: "123 Numbers", icon: "🍎", color: .green) {
                                        gameState.currentTab = .math
                                    }
                                    HotspotButton(title: "Puzzles", icon: "🧩", color: .purple) {
                                        gameState.currentTab = .puzzles
                                    }
                                    HotspotButton(title: "Stories", icon: "🎵", color: .orange) {
                                        gameState.currentTab = .stories
                                    }
                                }
                                .padding(.bottom, 12)
                            }
                            .padding()
                        )
                }
                .padding(.horizontal)
                
                // Daily Quest Card
                HStack(spacing: 16) {
                    Text("🐻")
                        .font(.system(size: 40))
                        .padding(10)
                        .background(Color.orange.opacity(0.2))
                        .clipShape(Circle())
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Today's Learning Quest")
                            .font(.system(.headline, design: .rounded))
                            .fontWeight(.black)
                        Text("Pick 5 apples & pop letter B balloons!")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        gameState.currentTab = .math
                    }) {
                        Text("Play! 🚀")
                            .font(.system(.subheadline, design: .rounded))
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.orange)
                            .clipShape(Capsule())
                    }
                }
                .padding()
                .background(Color(UIColor.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .padding(.horizontal)
                
                // 4 Learning Worlds Grid
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                    WorldCard(title: "Phonics Safari", subtitle: "Letters, Sounds & Trace", icon: "Aa", color: .pink) {
                        gameState.currentTab = .phonics
                    }
                    WorldCard(title: "Number Meadow", subtitle: "Counting & Math", icon: "123", color: .green) {
                        gameState.currentTab = .math
                    }
                    WorldCard(title: "Puzzle Peaks", subtitle: "Shapes & Logic", icon: "🔺", color: .purple) {
                        gameState.currentTab = .puzzles
                    }
                    WorldCard(title: "Story & Music", subtitle: "Read-Along & Piano", icon: "🎹", color: .orange) {
                        gameState.currentTab = .stories
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }
}

struct HotspotButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(icon)
                    .font(.system(size: 26))
                    .frame(width: 50, height: 50)
                    .background(color)
                    .clipShape(Circle())
                    .shadow(radius: 4)
                Text(title)
                    .font(.system(size: 10, design: .rounded))
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.6))
                    .clipShape(Capsule())
            }
        }
    }
}

struct WorldCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Text(icon)
                    .font(.title)
                    .padding(8)
                    .background(color.opacity(0.2))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                
                Spacer()
                
                Text(title)
                    .font(.system(.headline, design: .rounded))
                    .fontWeight(.black)
                    .foregroundColor(.primary)
                
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 120)
            .padding()
            .background(color.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .overlay(
                RoundedRectangle(cornerRadius: 22)
                    .stroke(color.opacity(0.3), lineWidth: 2)
            )
        }
    }
}
