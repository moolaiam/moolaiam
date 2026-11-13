#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

// The plugin window. It hosts the web UI (dist/mohits-ui.html, packed into the binary)
// in a WebBrowserComponent. Each parameter is a WebSliderRelay tied to the parameter tree.
// It also sends the output meter levels to the page about 30 times a second.
class MohitsEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit MohitsEditor (MohitsProcessor& processor);
    ~MohitsEditor() override;

    void resized() override;

private:
    void timerCallback() override;
    static std::optional<juce::WebBrowserComponent::Resource> serveUi (const juce::String& url);

    MohitsProcessor& processorRef;

    // Declared in this order, so the web view is destroyed before the relays it uses.
    std::vector<std::unique_ptr<juce::WebSliderRelay>> relays;
    std::vector<std::unique_ptr<juce::WebSliderParameterAttachment>> attachments;
    std::unique_ptr<juce::WebBrowserComponent> webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MohitsEditor)
};
