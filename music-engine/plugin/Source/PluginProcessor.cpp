#include "PluginProcessor.h"
#include "PluginEditor.h"

MusicEngineProcessor::MusicEngineProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

MusicEngineProcessor::~MusicEngineProcessor() = default;

void MusicEngineProcessor::prepareToPlay(double, int)
{
    playhead = 0.0;
}

void MusicEngineProcessor::setClip(juce::AudioBuffer<float> newClip, double clipSampleRate)
{
    const juce::SpinLock::ScopedLockType lock(clipLock);
    clip = std::move(newClip);
    clipRate = clipSampleRate;
    playhead = 0.0;
    playing.store(false);
}

void MusicEngineProcessor::clearClip()
{
    const juce::SpinLock::ScopedLockType lock(clipLock);
    clip.setSize(0, 0);
    playing.store(false);
}

bool MusicEngineProcessor::hasClip() const
{
    // Read-only from the UI thread; a briefly stale answer is acceptable.
    return clip.getNumSamples() > 0;
}

double MusicEngineProcessor::getClipSeconds() const
{
    return clipRate > 0.0 ? clip.getNumSamples() / clipRate : 0.0;
}

void MusicEngineProcessor::play()
{
    playhead = 0.0;
    playing.store(true);
}

void MusicEngineProcessor::stop()
{
    playing.store(false);
}

void MusicEngineProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn())
            play();

    if (!playing.load())
        return;

    const juce::SpinLock::ScopedTryLockType lock(clipLock);
    if (!lock.isLocked() || clip.getNumSamples() < 2)
        return;

    const int clipLength = clip.getNumSamples();
    const int clipChannels = clip.getNumChannels();
    const int outChannels = buffer.getNumChannels();
    const double step = clipRate / getSampleRate();   // resample on the fly

    for (int i = 0; i < buffer.getNumSamples(); ++i)
    {
        if (playhead >= clipLength - 1)
        {
            if (!looping)
            {
                playing.store(false);
                break;
            }
            playhead = 0.0;
        }

        const int idx = static_cast<int>(playhead);
        const float frac = static_cast<float>(playhead - idx);

        for (int ch = 0; ch < outChannels; ++ch)
        {
            const float* src = clip.getReadPointer(juce::jmin(ch, clipChannels - 1));
            const float sample = src[idx] * (1.0f - frac) + src[idx + 1] * frac;
            buffer.setSample(ch, i, sample);
        }
        playhead += step;
    }
}

juce::AudioProcessorEditor* MusicEngineProcessor::createEditor()
{
    return new MusicEngineEditor(*this);
}

void MusicEngineProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    juce::ValueTree state("MusicEngineState");
    state.setProperty("prompt", prompt, nullptr);
    state.setProperty("apiBaseUrl", apiBaseUrl, nullptr);
    state.setProperty("durationSeconds", durationSeconds, nullptr);
    state.setProperty("looping", looping, nullptr);
    copyXmlToBinary(*state.createXml(), destData);
}

void MusicEngineProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
    {
        auto state = juce::ValueTree::fromXml(*xml);
        if (state.isValid())
        {
            prompt = state.getProperty("prompt", "").toString();
            apiBaseUrl = state.getProperty("apiBaseUrl", apiBaseUrl).toString();
            durationSeconds = state.getProperty("durationSeconds", durationSeconds);
            looping = state.getProperty("looping", looping);
        }
    }
}

// This is the entry point the host calls to create the plug-in.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new MusicEngineProcessor();
}
