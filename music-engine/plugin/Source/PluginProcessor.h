#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

// Audio side of the plug-in. It plays a generated clip (a stereo buffer) through the
// host. A MIDI note-on restarts the clip, so the track follows the DAW's sequencer.
// The clip is swapped in from the UI thread under a spin lock. processBlock only
// try-locks, so it never blocks on the audio thread and outputs silence on a miss.
class MusicEngineProcessor : public juce::AudioProcessor
{
public:
    MusicEngineProcessor();
    ~MusicEngineProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Music Engine"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // UI-thread API.
    void setClip(juce::AudioBuffer<float> newClip, double clipSampleRate);
    void clearClip();
    void play();
    void stop();
    bool isPlaying() const { return playing.load(); }
    bool hasClip() const;
    double getClipSeconds() const;

    juce::String prompt;          // persisted with the project
    juce::String apiBaseUrl { "http://localhost:8000" };
    double durationSeconds = 30.0;
    bool looping = false;

private:
    juce::AudioBuffer<float> clip;
    double clipRate = 44100.0;
    juce::SpinLock clipLock;

    std::atomic<bool> playing { false };
    double playhead = 0.0;        // in clip samples; audio thread only

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MusicEngineProcessor)
};
