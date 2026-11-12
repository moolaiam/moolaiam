#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

namespace Mohits
{
    /// Builds every plugin parameter with the same IDs, ranges and defaults as src/params/spec.ts.
    /// All continuous parameters are stored normalized 0..1. The DSP converts them with ParamConversion.h.
    /// Requires JUCE 7 or newer (uses juce::ParameterID).
    juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
}
