#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ParamIDs.h"
#include <cmath>

MohitsProcessor::MohitsProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "PARAMETERS", Mohits::createParameterLayout())
{
    pInputTrim  = apvts.getRawParameterValue (MohitsIDs::inputGain);
    pOutputTrim = apvts.getRawParameterValue (MohitsIDs::outputGain);
    pMix        = apvts.getRawParameterValue (MohitsIDs::mix);
    pBypass     = apvts.getRawParameterValue (MohitsIDs::bypass);
}

void MohitsProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    currentBlockSize = samplesPerBlock;
    masterChain.prepare (currentSampleRate);
}

void MohitsProcessor::releaseResources()
{
    masterChain.prepare (currentSampleRate);
}

bool MohitsProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto mainIn  = layouts.getMainInputChannelSet();
    const auto mainOut = layouts.getMainOutputChannelSet();

    // Support {2, 2} stereo, {1, 2} mono-in/stereo-out (macOS Standalone mic / mono interface),
    // and {1, 1} mono-in/mono-out (mono DAW inserts & auval).
    if (mainIn != juce::AudioChannelSet::mono() && mainIn != juce::AudioChannelSet::stereo())
        return false;

    if (mainOut != juce::AudioChannelSet::mono() && mainOut != juce::AudioChannelSet::stereo())
        return false;

    if (mainIn == juce::AudioChannelSet::stereo() && mainOut == juce::AudioChannelSet::mono())
        return false;

    return true;
}

namespace
{
    // Raises an atomic peak if the new value is larger. Lock-free, safe on the audio thread.
    void raisePeak (std::atomic<float>& target, float value)
    {
        float current = target.load (std::memory_order_relaxed);
        while (value > current && ! target.compare_exchange_weak (current, value, std::memory_order_relaxed))
        {
        }
    }
}

void MohitsProcessor::publishMeters (const float* left, const float* right, int numSamples)
{
    if (numSamples <= 0)
        return;

    float peakL = 0.0f, peakR = 0.0f, sumL = 0.0f, sumR = 0.0f;
    for (int i = 0; i < numSamples; ++i)
    {
        const float l = left[i], r = right[i];
        peakL = std::fmax (peakL, std::fabs (l));
        peakR = std::fmax (peakR, std::fabs (r));
        sumL += l * l;
        sumR += r * r;
    }

    raisePeak (meters.peakL, peakL);
    raisePeak (meters.peakR, peakR);
    meters.rmsL.store (std::sqrt (sumL / static_cast<float> (numSamples)), std::memory_order_relaxed);
    meters.rmsR.store (std::sqrt (sumR / static_cast<float> (numSamples)), std::memory_order_relaxed);
}

void MohitsProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples    = buffer.getNumSamples();
    const int totalNumIn    = getTotalNumInputChannels();
    const int totalNumOut   = getTotalNumOutputChannels();

    if (numSamples <= 0 || totalNumOut <= 0)
        return;

    // If the host provided no active input channels, clear outputs cleanly and exit.
    if (totalNumIn <= 0)
    {
        buffer.clear();
        return;
    }

    // Clear any extra output channels beyond the active input channels first.
    for (int ch = totalNumIn; ch < totalNumOut; ++ch)
        buffer.clear (ch, 0, numSamples);

    masterChain.setParams (pInputTrim->load(),
                           pOutputTrim->load(),
                           pMix->load(),
                           pBypass->load() >= 0.5f);

    // Mono-in, mono-out ({1, 1})
    if (totalNumIn == 1 && totalNumOut == 1)
    {
        float* mono = buffer.getWritePointer (0);
        for (int i = 0; i < numSamples; ++i)
            masterChain.processMonoSample (mono[i]);
        publishMeters (mono, mono, numSamples);
        return;
    }

    // Mono-in, stereo-out ({1, 2}): duplicate mono input to the right channel before processing.
    if (totalNumIn == 1 && totalNumOut >= 2)
        buffer.copyFrom (1, 0, buffer, 0, 0, numSamples);

    float* left  = buffer.getWritePointer (0);
    float* right = buffer.getWritePointer (1);

#if MOHITS_TEST_TONE
    // Diagnostic: output a 440 Hz tone at -12 dBFS while the input receives signal.
    float inputPeak = 0.0f;
    for (int i = 0; i < numSamples; ++i)
        inputPeak = std::fmax (inputPeak, std::fmax (std::fabs (left[i]), std::fabs (right[i])));
    const float gate = inputPeak > 1.0e-5f ? 1.0f : 0.0f;

    static double testPhase = 0.0;
    const double increment = 2.0 * juce::MathConstants<double>::pi * 440.0 / currentSampleRate;
    for (int i = 0; i < numSamples; ++i)
    {
        const float s = gate * 0.25f * static_cast<float> (std::sin (testPhase));
        testPhase += increment;
        if (testPhase > 2.0 * juce::MathConstants<double>::pi)
            testPhase -= 2.0 * juce::MathConstants<double>::pi;
        left[i]  = s;
        right[i] = s;
    }
#else
    for (int i = 0; i < numSamples; ++i)
        masterChain.processSample (left[i], right[i]);
#endif

    // Clear any extra output channels beyond stereo.
    for (int ch = 2; ch < buffer.getNumChannels(); ++ch)
        buffer.clear (ch, 0, numSamples);

    publishMeters (left, right, numSamples);
}

juce::AudioProcessorEditor* MohitsProcessor::createEditor()
{
    return new MohitsEditor (*this);
}

void MohitsProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    if (auto xml = state.createXml())
        copyXmlToBinary (*xml, destData);
}

void MohitsProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml (getXmlFromBinary (data, sizeInBytes));
    if (xml != nullptr && xml->hasTagName (apvts.state.getType()))
        apvts.replaceState (juce::ValueTree::fromXml (*xml));
}

// JUCE calls this to create the plugin instance.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new MohitsProcessor();
}
