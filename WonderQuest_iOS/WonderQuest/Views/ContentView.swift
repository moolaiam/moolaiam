import SwiftUI

struct ContentView: View {
    @EnvironmentObject var gameState: GameState
    @State private var showParentGate = false

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header

                Divider()

                TabView(selection: $gameState.currentTab) {
                    AdventureMapView()
                        .tag(GameState.AppTab.map)
                    PhonicsSafariView()
                        .tag(GameState.AppTab.phonics)
                    NumberMeadowView()
                        .tag(GameState.AppTab.math)
                    PuzzlePeaksView()
                        .tag(GameState.AppTab.puzzles)
                    StoryAndMusicView()
                        .tag(GameState.AppTab.stories)
                    PrizeShopView()
                        .tag(GameState.AppTab.shop)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                bottomNavigation
            }

            if gameState.showCelebration {
                celebrationOverlay
            }
        }
        .sheet(isPresented: $showParentGate) {
            ParentHubSheet()
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(colors: [.orange, .yellow], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 44, height: 44)
                    Text(gameState.guide.emoji)
                        .font(.system(size: 24))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("WonderQuest")
                        .font(.system(.headline, design: .rounded))
                        .fontWeight(.black)
                        .foregroundColor(.primary)
                    Text("Ages 2–8 • Explorer")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            HStack(spacing: 8) {
                counterBadge(icon: "🎟️", value: gameState.tickets, color: .orange)
                counterBadge(icon: "⭐", value: gameState.stars, color: .yellow)

                Button(action: { showParentGate = true }) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.blue)
                        .padding(8)
                        .background(Color.blue.opacity(0.12))
                        .clipShape(Circle())
                }
                .accessibilityLabel("Parent Hub")
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Color(UIColor.secondarySystemBackground))
    }

    private func counterBadge(icon: String, value: Int, color: Color) -> some View {
        HStack(spacing: 4) {
            Text(icon)
            Text("\(value)")
                .font(.system(.subheadline, design: .rounded))
                .fontWeight(.black)
                .foregroundColor(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.15))
        .clipShape(Capsule())
    }

    private var bottomNavigation: some View {
        HStack {
            ForEach(GameState.AppTab.allCases) { tab in
                Spacer()
                Button(action: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        gameState.currentTab = tab
                    }
                    SoundManager.shared.playPop()
                }) {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 22, weight: gameState.currentTab == tab ? .black : .medium))
                            .foregroundColor(gameState.currentTab == tab ? .orange : .gray)
                            .scaleEffect(gameState.currentTab == tab ? 1.15 : 1.0)
                        Text(tab.rawValue)
                            .font(.system(size: 11, design: .rounded))
                            .fontWeight(gameState.currentTab == tab ? .black : .medium)
                            .foregroundColor(gameState.currentTab == tab ? .orange : .gray)
                    }
                    .frame(maxWidth: .infinity)
                }
                .accessibilityLabel(tab.rawValue)
                Spacer()
            }
        }
        .padding(.vertical, 10)
        .background(Color(UIColor.systemBackground).shadow(radius: 2))
    }

    private var celebrationOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Text("🌟")
                    .font(.system(size: 60))
                Text(gameState.celebrationTitle)
                    .font(.system(.title2, design: .rounded))
                    .fontWeight(.black)
                Text(gameState.celebrationMessage)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)

                HStack(spacing: 12) {
                    Label("+\(gameState.celebrationTickets) Tickets", systemImage: "ticket.fill")
                        .font(.headline)
                        .foregroundColor(.orange)
                    Text("+1 ⭐")
                        .font(.headline)
                }
                .padding()
                .background(Color.orange.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                Button(action: {
                    withAnimation { gameState.showCelebration = false }
                }) {
                    Text("Keep Playing! 🚀")
                        .font(.system(.headline, design: .rounded))
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.orange)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                }
            }
            .padding(24)
            .background(Color(UIColor.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 28))
            .shadow(radius: 20)
            .padding(32)
            .transition(.scale.combined(with: .opacity))
        }
    }
}
