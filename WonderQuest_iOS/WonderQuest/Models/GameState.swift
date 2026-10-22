import SwiftUI

/// Single source of truth for tickets, stars, the chosen animal guide, owned and
/// equipped items, and learning stats. Every change is saved to UserDefaults so
/// progress survives relaunches.
final class GameState: ObservableObject {

    enum AppTab: String, CaseIterable, Identifiable {
        case map = "Map"
        case phonics = "Phonics"
        case math = "Numbers"
        case puzzles = "Puzzles"
        case stories = "Stories"
        case shop = "Shop"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .map: return "map.fill"
            case .phonics: return "textformat.abc"
            case .math: return "number.circle.fill"
            case .puzzles: return "puzzlepiece.fill"
            case .stories: return "book.closed.fill"
            case .shop: return "gift.fill"
            }
        }
    }

    enum Guide: String, CaseIterable, Identifiable {
        case leo, bella, toby, penny

        var id: String { rawValue }
        var name: String { rawValue.capitalized }

        var emoji: String {
            switch self {
            case .leo: return "🦁"
            case .bella: return "🐰"
            case .toby: return "🦊"
            case .penny: return "🐧"
            }
        }
    }

    enum Slot: String {
        case hat, glasses, badge, sticker
    }

    struct ShopItem: Identifiable {
        let id: String
        let name: String
        let icon: String
        let price: Int
        let slot: Slot
    }

    static let outfits: [ShopItem] = [
        ShopItem(id: "party-crown", name: "Party Crown", icon: "👑", price: 30, slot: .hat),
        ShopItem(id: "cool-shades", name: "Cool Shades", icon: "🕶️", price: 25, slot: .glasses),
        ShopItem(id: "hero-medal", name: "Hero Medal", icon: "🏅", price: 40, slot: .badge),
        ShopItem(id: "super-cape", name: "Super Cape", icon: "🦸", price: 50, slot: .badge),
        ShopItem(id: "pup-buddy", name: "Pup Buddy", icon: "🐶", price: 60, slot: .badge)
    ]

    static let stickers: [ShopItem] = [
        ShopItem(id: "sticker-star", name: "Gold Star", icon: "⭐", price: 10, slot: .sticker),
        ShopItem(id: "sticker-butterfly", name: "Butterfly", icon: "🦋", price: 10, slot: .sticker),
        ShopItem(id: "sticker-rainbow", name: "Rainbow", icon: "🌈", price: 10, slot: .sticker),
        ShopItem(id: "sticker-rocket", name: "Rocket", icon: "🚀", price: 10, slot: .sticker),
        ShopItem(id: "sticker-flower", name: "Flower", icon: "🌸", price: 10, slot: .sticker),
        ShopItem(id: "sticker-dino", name: "Dino", icon: "🦕", price: 10, slot: .sticker)
    ]

    static func item(id: String) -> ShopItem? {
        (outfits + stickers).first { $0.id == id }
    }

    private enum Key {
        static let tickets = "wq_tickets"
        static let stars = "wq_stars"
        static let guide = "wq_guide"
        static let owned = "wq_owned"
        static let hat = "wq_equipped_hat"
        static let glasses = "wq_equipped_glasses"
        static let badge = "wq_equipped_badge"
        static let sound = "wq_sound"
        static let speech = "wq_speech_rate"
        static let limit = "wq_daily_limit"
        static let screen = "wq_screen_minutes"
        static let day = "wq_screen_day"
        static let phonicsAttempts = "wq_phonics_attempts"
        static let phonicsCorrect = "wq_phonics_correct"
        static let apples = "wq_apples"
        static let puzzles = "wq_puzzles"
    }

    private static var todayKey: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private let defaults = UserDefaults.standard
    private var currentDay = GameState.todayKey
    private var screenTimer: Timer?

    // Rewards & progress
    @Published var tickets: Int = 120 { didSet { save() } }
    @Published var stars: Int = 14 { didSet { save() } }
    @Published var guide: Guide = .leo { didSet { save() } }
    @Published var ownedItemIDs: Set<String> = [] { didSet { save() } }
    @Published var equippedHat: String? = nil { didSet { save() } }
    @Published var equippedGlasses: String? = nil { didSet { save() } }
    @Published var equippedBadge: String? = nil { didSet { save() } }

    // Settings (parent controlled)
    @Published var soundEnabled: Bool = true {
        didSet {
            SoundManager.shared.isEnabled = soundEnabled
            save()
        }
    }
    @Published var speechRate: Float = 0.5 {
        didSet {
            SoundManager.shared.speechRate = speechRate
            save()
        }
    }
    @Published var dailyLimitMinutes: Int = 30 { didSet { save() } }

    // Screen time & learning analytics
    @Published var screenMinutesToday: Int = 0 { didSet { save() } }
    @Published var phonicsAttempts: Int = 0 { didSet { save() } }
    @Published var phonicsCorrect: Int = 0 { didSet { save() } }
    @Published var applesHarvested: Int = 0 { didSet { save() } }
    @Published var puzzlesSolved: Int = 0 { didSet { save() } }

    // Navigation & celebration overlay
    @Published var currentTab: AppTab = .map
    @Published var showCelebration = false
    @Published var celebrationTitle = ""
    @Published var celebrationMessage = ""
    @Published var celebrationTickets = 20

    init() {
        let saved = defaults

        tickets = saved.object(forKey: Key.tickets) as? Int ?? 120
        stars = saved.object(forKey: Key.stars) as? Int ?? 14
        guide = Guide(rawValue: saved.string(forKey: Key.guide) ?? "") ?? .leo
        ownedItemIDs = Set(saved.stringArray(forKey: Key.owned) ?? [])
        equippedHat = saved.string(forKey: Key.hat)
        equippedGlasses = saved.string(forKey: Key.glasses)
        equippedBadge = saved.string(forKey: Key.badge)
        soundEnabled = saved.object(forKey: Key.sound) as? Bool ?? true
        speechRate = saved.object(forKey: Key.speech) as? Float ?? 0.5
        dailyLimitMinutes = saved.object(forKey: Key.limit) as? Int ?? 30
        screenMinutesToday = saved.string(forKey: Key.day) == currentDay
            ? saved.object(forKey: Key.screen) as? Int ?? 0
            : 0
        phonicsAttempts = saved.object(forKey: Key.phonicsAttempts) as? Int ?? 0
        phonicsCorrect = saved.object(forKey: Key.phonicsCorrect) as? Int ?? 0
        applesHarvested = saved.object(forKey: Key.apples) as? Int ?? 0
        puzzlesSolved = saved.object(forKey: Key.puzzles) as? Int ?? 0

        SoundManager.shared.isEnabled = soundEnabled
        SoundManager.shared.speechRate = speechRate

        // Counts minutes while the app is open, for the parent screen-time card.
        screenTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.addScreenMinute()
        }
    }

    // MARK: - Rewards

    func reward(title: String, message: String, ticketsCount: Int = 20, starsCount: Int = 1) {
        tickets += ticketsCount
        stars += starsCount
        celebrationTitle = title
        celebrationMessage = message
        celebrationTickets = ticketsCount
        showCelebration = true
        SoundManager.shared.playFanfare()
    }

    // MARK: - Shop

    func owns(_ item: ShopItem) -> Bool {
        ownedItemIDs.contains(item.id)
    }

    func isEquipped(_ item: ShopItem) -> Bool {
        equippedID(for: item.slot) == item.id
    }

    /// Buys an item if it is not owned yet. Returns false when the child lacks tickets.
    func purchase(_ item: ShopItem) -> Bool {
        if owns(item) { return true }
        guard tickets >= item.price else { return false }
        tickets -= item.price
        ownedItemIDs.insert(item.id)
        SoundManager.shared.playFanfare()
        return true
    }

    /// Puts an owned outfit on the guide, or takes it off if it is already worn.
    func toggleEquip(_ item: ShopItem) {
        guard owns(item), item.slot != .sticker else { return }
        let newValue: String? = isEquipped(item) ? nil : item.id
        switch item.slot {
        case .hat: equippedHat = newValue
        case .glasses: equippedGlasses = newValue
        case .badge: equippedBadge = newValue
        case .sticker: break
        }
        SoundManager.shared.playPop()
    }

    func equippedID(for slot: Slot) -> String? {
        switch slot {
        case .hat: return equippedHat
        case .glasses: return equippedGlasses
        case .badge: return equippedBadge
        case .sticker: return nil
        }
    }

    // MARK: - Analytics

    var phonicsAccuracy: Int {
        guard phonicsAttempts > 0 else { return 0 }
        return Int((Double(phonicsCorrect) / Double(phonicsAttempts) * 100).rounded())
    }

    // MARK: - Persistence

    private func addScreenMinute() {
        if currentDay != GameState.todayKey {
            currentDay = GameState.todayKey
            screenMinutesToday = 0
        }
        screenMinutesToday += 1
    }

    private func save() {
        defaults.set(tickets, forKey: Key.tickets)
        defaults.set(stars, forKey: Key.stars)
        defaults.set(guide.rawValue, forKey: Key.guide)
        defaults.set(Array(ownedItemIDs), forKey: Key.owned)
        defaults.set(equippedHat, forKey: Key.hat)
        defaults.set(equippedGlasses, forKey: Key.glasses)
        defaults.set(equippedBadge, forKey: Key.badge)
        defaults.set(soundEnabled, forKey: Key.sound)
        defaults.set(speechRate, forKey: Key.speech)
        defaults.set(dailyLimitMinutes, forKey: Key.limit)
        defaults.set(screenMinutesToday, forKey: Key.screen)
        defaults.set(currentDay, forKey: Key.day)
        defaults.set(phonicsAttempts, forKey: Key.phonicsAttempts)
        defaults.set(phonicsCorrect, forKey: Key.phonicsCorrect)
        defaults.set(applesHarvested, forKey: Key.apples)
        defaults.set(puzzlesSolved, forKey: Key.puzzles)
    }
}
