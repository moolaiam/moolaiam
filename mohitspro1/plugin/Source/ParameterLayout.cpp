#include "ParameterLayout.h"
#include "ParamIDs.h"

namespace Mohits
{
    namespace
    {
        // Choice lists. These must match the arrays in src/params/spec.ts, in the same order.
        const juce::StringArray neuralTypes  { "Tube", "Transformer", "Tape", "Console", "Solid State" };
        const juce::StringArray filterSlopes { "6dB", "12dB", "24dB", "48dB" };
        const juce::StringArray channelModes { "L/R", "M/S" };
        const juce::StringArray qualityModes { "1x", "2x", "4x" };

        using Layout = juce::AudioProcessorValueTreeState::ParameterLayout;

        // Normalized 0..1 continuous parameter. Default is also normalized.
        void addContinuous (Layout& layout, const char* id, const char* name, float defaultNorm)
        {
            layout.add (std::make_unique<juce::AudioParameterFloat> (
                juce::ParameterID { id, 1 }, name,
                juce::NormalisableRange<float> (0.0f, 1.0f, 0.001f), defaultNorm));
        }

        void addToggle (Layout& layout, const char* id, const char* name, bool defaultOn)
        {
            layout.add (std::make_unique<juce::AudioParameterBool> (juce::ParameterID { id, 1 }, name, defaultOn));
        }

        void addChoice (Layout& layout, const char* id, const char* name, const juce::StringArray& options, int defaultIndex)
        {
            layout.add (std::make_unique<juce::AudioParameterChoice> (juce::ParameterID { id, 1 }, name, options, defaultIndex));
        }
    }

    juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
    {
        Layout layout;

        // Master
        addContinuous (layout, MohitsIDs::inputGain,  "Input Trim",         0.5f);
        addContinuous (layout, MohitsIDs::outputGain, "Output Trim",        0.5f);
        addContinuous (layout, MohitsIDs::mix,        "Dry / Wet Mix",      1.0f);
        addToggle     (layout, MohitsIDs::bypass,     "Bypass",             false);
        addToggle     (layout, MohitsIDs::levelMatch, "Level Match",        true);
        addChoice     (layout, MohitsIDs::quality,    "Quality (Oversampling)", qualityModes, 1); // 2x

        // Neural emulation slots. Defaults match SLOT_DEFAULTS in spec.ts.
        const float slotGainDefault[4]     = { 0.52f, 0.48f, 0.55f, 0.50f };
        const float slotDriveDefault[4]    = { 0.35f, 0.42f, 0.30f, 0.50f };
        const float slotHarmonicDefault[4] = { 0.45f, 0.55f, 0.40f, 0.60f };
        const bool  slotX2Default[4]       = { false, true,  false, false };
        const int   slotTypeDefault[4]     = { 0, 1, 2, 3 }; // Tube, Transformer, Tape, Console

        for (int n = 0; n < 4; ++n)
        {
            const juce::String label = "Slot " + juce::String (n + 1) + " ";
            addToggle     (layout, MohitsIDs::slotEnabled[n],  (label + "Enabled").toRawUTF8(),         true);
            addContinuous (layout, MohitsIDs::slotGain[n],     (label + "Gain").toRawUTF8(),            slotGainDefault[n]);
            addContinuous (layout, MohitsIDs::slotDrive[n],    (label + "Drive").toRawUTF8(),           slotDriveDefault[n]);
            addToggle     (layout, MohitsIDs::slotX2[n],       (label + "X2").toRawUTF8(),              slotX2Default[n]);
            addContinuous (layout, MohitsIDs::slotHarmonic[n], (label + "Harmonic Exp").toRawUTF8(),   slotHarmonicDefault[n]);
            addChoice     (layout, MohitsIDs::slotType[n],     (label + "Type").toRawUTF8(), neuralTypes, slotTypeDefault[n]);
        }

        // One Knob EQ
        addContinuous (layout, MohitsIDs::eqCharacter, "EQ Character",  0.50f);
        addContinuous (layout, MohitsIDs::eqTilt,      "EQ Tilt",       0.50f);
        addContinuous (layout, MohitsIDs::eqSweetSpot, "Sweet Spot",    0.65f);

        // High pass and low pass. Slope default is 24 dB/oct (index 2).
        addContinuous (layout, MohitsIDs::hpfFreq,      "HPF Frequency", 0.18f);
        addContinuous (layout, MohitsIDs::hpfResonance, "HPF Resonance", 0.25f);
        addContinuous (layout, MohitsIDs::hpfDrive,     "HPF Drive",     0.20f);
        addChoice     (layout, MohitsIDs::hpfSlope,     "HPF Slope",     filterSlopes, 2);

        addContinuous (layout, MohitsIDs::lpfFreq,      "LPF Frequency", 0.82f);
        addContinuous (layout, MohitsIDs::lpfResonance, "LPF Resonance", 0.25f);
        addContinuous (layout, MohitsIDs::lpfDrive,     "LPF Drive",     0.20f);
        addChoice     (layout, MohitsIDs::lpfSlope,     "LPF Slope",     filterSlopes, 2);

        // Routing
        addToggle (layout, MohitsIDs::preEq,       "Pre EQ",        true);
        addToggle (layout, MohitsIDs::postFilters, "Post Filters",  true);
        addChoice (layout, MohitsIDs::channelMode, "Channel Mode",  channelModes, 0);

        return layout;
    }
}
