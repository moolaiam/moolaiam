import Foundation
import AVFoundation
import AudioToolbox

/// Voice prompts (AVSpeechSynthesizer) and pitched xylophone tones (AVAudioEngine).
final class SoundManager {
    static let shared = SoundManager()

    /// Mirrors the parent setting. When false, nothing is played or spoken.
    var isEnabled = true
    /// Speech rate for AVSpeechUtterance: 0.4 is gentle, 0.5 is standard.
    var speechRate: Float = 0.5

    private let synthesizer = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        do {
            try engine.start()
        } catch {
            print("WonderQuest: audio engine failed to start: \(error)")
        }
    }

    func speak(_ text: String) {
        guard isEnabled else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = speechRate
        utterance.pitchMultiplier = 1.25 // Cheerful, friendly pitch
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.stopSpeaking(at: .immediate)
        synthesizer.speak(utterance)
    }

    /// Plays a sine tone with a xylophone-style decay.
    func playTone(_ frequency: Double, duration: Double = 0.6) {
        guard isEnabled else { return }
        let frameCount = AVAudioFrameCount(duration * format.sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
              let samples = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = frameCount
        for frame in 0..<Int(frameCount) {
            let time = Double(frame) / format.sampleRate
            let envelope = exp(-5 * time / duration)
            samples[frame] = Float(sin(2 * Double.pi * frequency * time) * envelope * 0.4)
        }
        if !engine.isRunning { try? engine.start() }
        player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
        player.play()
    }

    func playPop() {
        guard isEnabled else { return }
        AudioServicesPlaySystemSound(1104)
    }

    func playWrong() {
        playTone(180, duration: 0.2)
    }

    /// Four-note C E G C arpeggio for rewards.
    func playFanfare() {
        guard isEnabled else { return }
        for (index, note) in [261.63, 329.63, 392.00, 523.25].enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.11) {
                self.playTone(note, duration: 0.3)
            }
        }
    }
}
