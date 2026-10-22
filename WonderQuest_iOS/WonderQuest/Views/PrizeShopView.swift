import SwiftUI

struct PrizeShopView: View {
    @EnvironmentObject var gameState: GameState

    private let outfitColumns = [GridItem(.flexible()), GridItem(.flexible())]
    private let stickerColumns = Array(repeating: GridItem(.flexible()), count: 3)

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                avatarStage
                guidePicker

                sectionTitle("Outfits & Badges")
                LazyVGrid(columns: outfitColumns, spacing: 16) {
                    ForEach(GameState.outfits) { item in
                        ShopItemCard(item: item)
                    }
                }
                .padding(.horizontal)

                sectionTitle("Sticker Book")
                LazyVGrid(columns: stickerColumns, spacing: 12) {
                    ForEach(GameState.stickers) { sticker in
                        StickerTile(sticker: sticker)
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }

    private var avatarStage: some View {
        HStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [.orange, .yellow], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 120, height: 120)

                Text(gameState.guide.emoji)
                    .font(.system(size: 64))

                if let hat = equippedIcon(gameState.equippedHat) {
                    Text(hat)
                        .font(.system(size: 40))
                        .offset(y: -62)
                }
                if let glasses = equippedIcon(gameState.equippedGlasses) {
                    Text(glasses)
                        .font(.system(size: 30))
                        .offset(y: -4)
                }
                if let badge = equippedIcon(gameState.equippedBadge) {
                    Text(badge)
                        .font(.system(size: 30))
                        .offset(x: 46, y: 46)
                }
            }
            .frame(width: 160, height: 160)

            VStack(alignment: .leading, spacing: 6) {
                Text("\(gameState.guide.name) the Explorer")
                    .font(.system(.headline, design: .rounded))
                    .fontWeight(.black)
                Text(equippedSummary)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Label("\(gameState.tickets) Tickets", systemImage: "ticket.fill")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
            }

            Spacer(minLength: 0)
        }
        .padding()
        .background(Color.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .padding(.horizontal)
    }

    private var guidePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Choose your animal guide")
                .font(.subheadline)
                .fontWeight(.bold)

            HStack(spacing: 10) {
                ForEach(GameState.Guide.allCases) { guide in
                    let isSelected = gameState.guide == guide
                    Button(action: {
                        gameState.guide = guide
                        SoundManager.shared.playPop()
                    }) {
                        VStack(spacing: 4) {
                            Text(guide.emoji)
                                .font(.system(size: 30))
                            Text(guide.name)
                                .font(.caption)
                                .fontWeight(.bold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(isSelected ? Color.orange.opacity(0.25) : Color(UIColor.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(isSelected ? Color.orange : Color.clear, lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(.headline, design: .rounded))
            .fontWeight(.black)
            .padding(.horizontal)
    }

    private func equippedIcon(_ itemID: String?) -> String? {
        guard let itemID, let item = GameState.item(id: itemID) else { return nil }
        return item.icon
    }

    private var equippedSummary: String {
        let names = [gameState.equippedHat, gameState.equippedGlasses, gameState.equippedBadge]
            .compactMap { itemID -> String? in
                guard let itemID, let item = GameState.item(id: itemID) else { return nil }
                return item.name
            }
        return names.isEmpty ? "Nothing equipped yet. Pick an outfit!" : "Wearing: " + names.joined(separator: ", ")
    }
}

struct ShopItemCard: View {
    @EnvironmentObject var gameState: GameState
    let item: GameState.ShopItem

    private var owned: Bool { gameState.owns(item) }
    private var equipped: Bool { gameState.isEquipped(item) }

    var body: some View {
        VStack(spacing: 10) {
            Text(item.icon)
                .font(.system(size: 40))
            Text(item.name)
                .font(.system(.subheadline, design: .rounded))
                .fontWeight(.bold)

            Button(action: handleTap) {
                Text(buttonTitle)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(buttonColor)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(UIColor.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var buttonTitle: String {
        if !owned { return "🎟️ \(item.price)" }
        return equipped ? "Take Off" : "Equip"
    }

    private var buttonColor: Color {
        if !owned { return .orange }
        return equipped ? .gray : .green
    }

    private func handleTap() {
        if owned {
            gameState.toggleEquip(item)
        } else if gameState.purchase(item) {
            gameState.toggleEquip(item)
        } else {
            SoundManager.shared.speak("You need more tickets! Play games to earn tickets!")
        }
    }
}

struct StickerTile: View {
    @EnvironmentObject var gameState: GameState
    let sticker: GameState.ShopItem

    var body: some View {
        let collected = gameState.owns(sticker)
        return Button(action: { tap(collected: collected) }) {
            VStack(spacing: 4) {
                Text(collected ? sticker.icon : "❔")
                    .font(.system(size: 30))
                    .opacity(collected ? 1 : 0.35)
                Text(collected ? sticker.name : "🎟️ \(sticker.price)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 90)
            .background(collected ? Color.yellow.opacity(0.15) : Color(UIColor.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }

    private func tap(collected: Bool) {
        if collected {
            SoundManager.shared.speak(sticker.name)
        } else if !gameState.purchase(sticker) {
            SoundManager.shared.speak("You need more tickets! Play games to earn tickets!")
        }
    }
}
