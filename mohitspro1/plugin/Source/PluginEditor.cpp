#include "PluginEditor.h"
#include "ParamIDs.h"
#include "BinaryData.h"

namespace
{
    // Every parameter the web UI controls. This list must match PARAM_IDS in src/params/spec.ts.
    std::vector<const char*> allParameterIDs()
    {
        std::vector<const char*> ids {
            MohitsIDs::inputGain, MohitsIDs::outputGain, MohitsIDs::mix,
            MohitsIDs::bypass, MohitsIDs::levelMatch, MohitsIDs::quality,
        };

        for (int n = 0; n < 4; ++n)
        {
            ids.push_back (MohitsIDs::slotEnabled[n]);
            ids.push_back (MohitsIDs::slotGain[n]);
            ids.push_back (MohitsIDs::slotDrive[n]);
            ids.push_back (MohitsIDs::slotX2[n]);
            ids.push_back (MohitsIDs::slotHarmonic[n]);
            ids.push_back (MohitsIDs::slotType[n]);
        }

        ids.insert (ids.end(), {
            MohitsIDs::eqCharacter, MohitsIDs::eqTilt, MohitsIDs::eqSweetSpot,
            MohitsIDs::hpfFreq, MohitsIDs::hpfResonance, MohitsIDs::hpfDrive, MohitsIDs::hpfSlope,
            MohitsIDs::lpfFreq, MohitsIDs::lpfResonance, MohitsIDs::lpfDrive, MohitsIDs::lpfSlope,
            MohitsIDs::preEq, MohitsIDs::postFilters, MohitsIDs::channelMode,
        });

        return ids;
    }
}

MohitsEditor::MohitsEditor (MohitsProcessor& processor)
    : AudioProcessorEditor (processor)
{
    // One relay per parameter. The attachment keeps the relay and the parameter in sync,
    // including gestures and host automation.
    for (const auto* id : allParameterIDs())
    {
        auto* param = processor.apvts.getParameter (id);
        jassert (param != nullptr);
        if (param == nullptr)
            continue;

        auto relay = std::make_unique<juce::WebSliderRelay> (id);
        attachments.push_back (std::make_unique<juce::WebSliderParameterAttachment> (*param, *relay, nullptr));
        relays.push_back (std::move (relay));
    }

    auto options = juce::WebBrowserComponent::Options{}
                       .withNativeIntegrationEnabled()
                       .withResourceProvider (&MohitsEditor::serveUi);

    for (auto& relay : relays)
        options = options.withOptionsFrom (*relay);

    webView = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*webView);
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setSize (960, 800);
    setResizable (false, false);
}

MohitsEditor::~MohitsEditor() = default;

void MohitsEditor::resized()
{
    if (webView != nullptr)
        webView->setBounds (getLocalBounds());
}

// Every URL gets the same packed page, since the UI is a single file.
std::optional<juce::WebBrowserComponent::Resource> MohitsEditor::serveUi (const juce::String&)
{
    if (BinaryData::mohitsui_html == nullptr || BinaryData::mohitsui_htmlSize <= 0)
        return std::nullopt;

    const auto* begin = reinterpret_cast<const std::byte*> (BinaryData::mohitsui_html);
    return juce::WebBrowserComponent::Resource {
        std::vector<std::byte> (begin, begin + BinaryData::mohitsui_htmlSize),
        "text/html",
    };
}
