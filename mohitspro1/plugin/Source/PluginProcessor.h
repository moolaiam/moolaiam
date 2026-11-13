#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "ParameterLayout.h"
#include "MasterChain.h"

class MohitsProcessor : public juce::AudioProcessor
{
public:
    MohitsProcessor();
    ~MohitsProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "MOHITS PRO 1"; }
    bool acceptsMidi() const override  { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // Every parameter lives here. The UI and the host both talk to this.
    juce::AudioProcessorValueTreeState apvts;

private:
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    // Master section (step 3). Trims, mix and bypass from the parameter tree.
    MohitsDSP::MasterChain masterChain;
    std::atomic<float>* pInputTrim  = nullptr;
    std::atomic<float>* pOutputTrim = nullptr;
    std::atomic<float>* pMix        = nullptr;
    std::atomic<float>* pBypass     = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MohitsProcessor)
};
