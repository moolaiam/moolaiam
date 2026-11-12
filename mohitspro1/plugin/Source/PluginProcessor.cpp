#include "PluginProcessor.h"
#include "PluginEditor.h"

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
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    masterChain.prepare (sampleRate);
}

bool MohitsProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    // Stereo in, stereo out only. Matches the {2, 2} channel setting.
    return layouts.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void MohitsProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();

    // Stereo only, matching the bus layout. Anything else passes through untouched.
    if (buffer.getNumChannels() < 2)
        return;

    masterChain.setParams (pInputTrim->load(),
                           pOutputTrim->load(),
                           pMix->load(),
                           pBypass->load() >= 0.5f);

    float* left  = buffer.getWritePointer (0);
    float* right = buffer.getWritePointer (1);

    for (int i = 0; i < numSamples; ++i)
        masterChain.processSample (left[i], right[i]);

    // Clear any extra output channels.
    for (int ch = 2; ch < buffer.getNumChannels(); ++ch)
        buffer.clear (ch, 0, numSamples);
}

juce::AudioProcessorEditor* MohitsProcessor::createEditor()
{
    return new MohitsEditor (*this);
}

void MohitsProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());
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
