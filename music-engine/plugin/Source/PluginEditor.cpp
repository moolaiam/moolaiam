#include "PluginEditor.h"

namespace
{
constexpr int width = 520;
constexpr int height = 420;
constexpr int margin = 16;
constexpr int rowHeight = 28;
}

MusicEngineEditor::MusicEngineEditor(MusicEngineProcessor& p)
    : AudioProcessorEditor(&p), processor(p)
{
    setSize(width, height);

    titleLabel.setText("Music Engine", juce::dontSendNotification);
    titleLabel.setFont(juce::FontOptions(20.0f, juce::Font::bold));

    promptLabel.setText("Prompt, theme or lyrics", juce::dontSendNotification);
    promptEditor.setMultiLine(true);
    promptEditor.setReturnKeyStartsNewLine(true);
    promptEditor.setText(processor.prompt, juce::dontSendNotification);
    promptEditor.onTextChange = [this] { processor.prompt = promptEditor.getText(); };

    durationLabel.setText("Duration (s)", juce::dontSendNotification);
    durationSlider.setRange(5.0, 240.0, 1.0);
    durationSlider.setValue(processor.durationSeconds, juce::dontSendNotification);
    durationSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    durationSlider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 60, 20);
    durationSlider.onValueChange = [this] { processor.durationSeconds = durationSlider.getValue(); };

    generateButton.onClick = [this] { onGenerateClicked(); };
    loadButton.onClick = [this] { onLoadWavClicked(); };
    playButton.onClick = [this] { onTransportClicked(); };
    loopToggle.setToggleState(processor.looping, juce::dontSendNotification);
    loopToggle.onClick = [this] { processor.looping = loopToggle.getToggleState(); };

    statusLabel.setText("Ready", juce::dontSendNotification);
    clipLabel.setText(processor.hasClip() ? "Clip loaded" : "No clip loaded", juce::dontSendNotification);

    // Explicit Component* array: a braced list of mixed derived pointer types will not deduce.
    juce::Component* children[] = { &titleLabel, &promptLabel, &promptEditor,
                                    &durationLabel, &durationSlider, &instrumentalToggle,
                                    &generateButton, &loadButton, &playButton, &loopToggle,
                                    &statusLabel, &clipLabel };
    for (auto* c : children)
        addAndMakeVisible(c);

    startTimerHz(10);
}

MusicEngineEditor::~MusicEngineEditor()
{
    stopTimer();
    client.cancel();
}

void MusicEngineEditor::paint(juce::Graphics& g)
{
    g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
}

void MusicEngineEditor::resized()
{
    auto area = getLocalBounds().reduced(margin);
    titleLabel.setBounds(area.removeFromTop(rowHeight + 8));
    promptLabel.setBounds(area.removeFromTop(rowHeight));
    promptEditor.setBounds(area.removeFromTop(120));
    area.removeFromTop(margin / 2);

    auto durRow = area.removeFromTop(rowHeight);
    durationLabel.setBounds(durRow.removeFromLeft(110));
    instrumentalToggle.setBounds(durRow.removeFromRight(120));
    durationSlider.setBounds(durRow);
    area.removeFromTop(margin / 2);

    auto buttons = area.removeFromTop(rowHeight + 8);
    generateButton.setBounds(buttons.removeFromLeft(150));
    buttons.removeFromLeft(margin / 2);
    loadButton.setBounds(buttons.removeFromLeft(150));

    area.removeFromTop(margin / 2);
    auto transport = area.removeFromTop(rowHeight);
    playButton.setBounds(transport.removeFromLeft(110));
    loopToggle.setBounds(transport.removeFromLeft(90));
    clipLabel.setBounds(transport);

    statusLabel.setBounds(area.removeFromBottom(rowHeight));
}

void MusicEngineEditor::setBusy(bool busy)
{
    generateButton.setEnabled(!busy);
    loadButton.setEnabled(!busy);
    generateButton.setButtonText(busy ? "Working..." : "Generate");
}

void MusicEngineEditor::showStatus(const juce::String& text)
{
    statusLabel.setText(text, juce::dontSendNotification);
}

void MusicEngineEditor::applyClip(juce::AudioBuffer<float> audio, double sampleRate, const juce::String& source)
{
    const auto seconds = audio.getNumSamples() / sampleRate;
    processor.setClip(std::move(audio), sampleRate);
    clipLabel.setText(source + " (" + juce::String(seconds, 1) + " s)", juce::dontSendNotification);
    showStatus("Ready");
}

void MusicEngineEditor::onGenerateClicked()
{
    const auto prompt = promptEditor.getText().trim();
    if (prompt.isEmpty())
    {
        showStatus("Enter a prompt first");
        return;
    }
    const auto apiKey = EngineClient::apiKeyFromEnvironment();
    if (apiKey.isEmpty())
        showStatus("Warning: MUSICENGINE_API_KEY is not set");

    EngineClient::Request req;
    req.baseUrl = processor.apiBaseUrl;
    req.apiKey = apiKey;
    req.prompt = prompt;
    req.durationSeconds = processor.durationSeconds;
    req.instrumental = instrumentalToggle.getToggleState();

    setBusy(true);
    showStatus("Submitting...");

    juce::Component::SafePointer<MusicEngineEditor> safe(this);
    client.start(
        std::move(req),
        [safe](juce::String status, float progress) {
            if (safe != nullptr)
                safe->showStatus(status + " " + juce::String(juce::roundToInt(progress * 100.0f)) + "%");
        },
        [safe](EngineClient::Outcome outcome) {
            if (safe == nullptr)
                return;
            safe->setBusy(false);
            if (outcome.ok)
                safe->applyClip(std::move(outcome.audio), outcome.sampleRate, "Generated");
            else
                safe->showStatus("Error: " + outcome.error);
        });
}

void MusicEngineEditor::onLoadWavClicked()
{
    // Offline path: load a WAV rendered by the CLI, so the plug-in can be tested without the server.
    chooser = std::make_unique<juce::FileChooser>("Choose a rendered WAV", juce::File(), "*.wav");
    juce::Component::SafePointer<MusicEngineEditor> safe(this);
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [safe](const juce::FileChooser& fc) {
            if (safe == nullptr)
                return;
            const auto file = fc.getResult();
            if (!file.existsAsFile())
                return;
            juce::AudioFormatManager formats;
            formats.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
            if (reader == nullptr)
            {
                safe->showStatus("Could not read that file");
                return;
            }
            juce::AudioBuffer<float> audio(static_cast<int>(reader->numChannels),
                                           static_cast<int>(reader->lengthInSamples));
            reader->read(&audio, 0, audio.getNumSamples(), 0, true, reader->numChannels > 1);
            safe->applyClip(std::move(audio), reader->sampleRate, file.getFileName());
        });
}

void MusicEngineEditor::onTransportClicked()
{
    if (!processor.hasClip())
    {
        showStatus("Generate or load a clip first");
        return;
    }
    if (processor.isPlaying())
        processor.stop();
    else
        processor.play();
}

void MusicEngineEditor::timerCallback()
{
    playButton.setButtonText(processor.isPlaying() ? "Stop" : "Play");
}
