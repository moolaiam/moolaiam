#pragma once

#include <juce_gui_basics/juce_gui_basics.h>
#include "PluginProcessor.h"

// Placeholder editor. Step 11 replaces it with a WebBrowserComponent that loads the
// built web UI from ../dist.
class MohitsEditor : public juce::AudioProcessorEditor
{
public:
    explicit MohitsEditor (MohitsProcessor& processor);
    ~MohitsEditor() override = default;

    void paint (juce::Graphics& g) override;
    void resized() override;

private:
    juce::Label message;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MohitsEditor)
};
