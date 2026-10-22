# WonderQuest: iOS Kids Learning Adventure (Ages 2–8)

Native SwiftUI app for iPhone and iPad, plus the interactive browser prototype it was designed from.

## Contents
- `WonderQuest.xcodeproj`: Xcode project (iOS 16+, iPhone and iPad, Swift 5).
- `WonderQuest/`: app source and assets.
  - `WonderQuestApp.swift`: app entry point.
  - `Models/GameState.swift`: tickets, stars, animal guide, owned and equipped items, stickers, screen-time limit, learning stats. Saved to UserDefaults.
  - `Audio/SoundManager.swift`: speech (`AVSpeechSynthesizer`), pitched xylophone tones (`AVAudioEngine`), and short feedback sounds.
  - `Views/ContentView.swift`: header with counters, page-style tab container, bottom navigation, reward overlay.
  - `Views/AdventureMapView.swift`: island hub with learning worlds and today's quest.
  - `Views/PhonicsSafariView.swift`: balloon pop (5 targets per round), letter trace, and A–Z sound board.
  - `Views/NumberMeadowView.swift`: apple harvest with a 1–8 number line that lights up as apples are picked.
  - `Views/PuzzlePeaksView.swift`: shape-to-silhouette matching with a Dolphin Bay reveal.
  - `Views/StoryAndMusicView.swift`: three-page storybook with word-by-word read-along, and a 7-note xylophone with a Twinkle, Twinkle demo.
  - `Views/PrizeShopView.swift`: guide picker, avatar stage, outfits (unlock, then equip or take off), and a sticker book.
  - `Views/ParentDashboardView.swift`: math gate, then the Parent Hub with screen-time limit, learning analytics, sound and voice settings, and Apple Kids Category notes.
  - `Assets.xcassets`: app icon placeholder and accent color.
  - `Info.plist`: 64-bit device requirement, launch screen, light appearance.
- `WonderQuest_Prototype.html`: the browser prototype. Open it in any modern browser.

## Running the app in Xcode
1. Open `WonderQuest.xcodeproj` in Xcode 16 or later on a Mac.
2. Select the **WonderQuest** target → **Signing & Capabilities** and choose your team.
3. Change the bundle identifier from `com.example.WonderQuest` to your own.
4. Pick an iPhone or iPad simulator and press **⌘R**.

## Before submitting to the App Store
- Replace the placeholder app icon in `Assets.xcassets/AppIcon.appiconset` with final artwork (1024×1024).
- Set the app's category to **Kids** in App Store Connect and complete the Kids Category age-rating and privacy questions yourself. Nothing in the project can set those for you.
- The Parent Hub's "Screen Time" card counts time on this device while the app is open. It is not connected to Apple's Screen Time API.
