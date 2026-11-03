#pragma once

#include "EngineClient.h"
#include "PluginProcessor.h"

class MusicEngineEditor : public juce::AudioProcessorEditor,
                          private juce::Timer
{
public:
    explicit MusicEngineEditor(MusicEngineProcessor&);
    ~MusicEngineEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void onGenerateClicked();
    void onLoadWavClicked();
    void onTransportClicked();
    void setBusy(bool busy);
    void showStatus(const juce::String& text);
    void applyClip(juce::AudioBuffer<float> audio, double sampleRate, const juce::String& source);

    MusicEngineProcessor& processor;

    juce::Label titleLabel, promptLabel, durationLabel, statusLabel;
    juce::TextEditor promptEditor;
    juce::Slider durationSlider;
    juce::ToggleButton instrumentalToggle { "Instrumental" };
    juce::TextButton generateButton { "Generate" };
    juce::TextButton loadButton { "Load WAV..." };
    juce::TextButton playButton { "Play" };
    juce::ToggleButton loopToggle { "Loop" };
    juce::Label clipLabel;

    EngineClient client;
    std::unique_ptr<juce::FileChooser> chooser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MusicEngineEditor)
};
