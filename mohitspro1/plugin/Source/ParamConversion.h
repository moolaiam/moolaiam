#pragma once

// Pure C++ (no JUCE). Converts normalized 0..1 parameter values into DSP units.
// Each function mirrors the display formatter in src/params/spec.ts, so what the
// user reads on screen is what the DSP uses.

#include <algorithm>
#include <cmath>

namespace MohitsConv
{
    inline float clamp01 (float v)
    {
        if (! std::isfinite (v)) return 0.0f;
        return std::clamp (v, 0.0f, 1.0f);
    }

    /// Bipolar dB trim. 0.5 = 0 dB, 0 = -12 dB, 1 = +12 dB (spec.ts: formatDbBipolar).
    inline float trimDb (float norm)
    {
        return (clamp01 (norm) - 0.5f) * 24.0f;
    }

    inline float trimLinear (float norm)
    {
        return std::pow (10.0f, trimDb (norm) / 20.0f);
    }

    /// Log-mapped frequency between minHz and maxHz (spec.ts: formatLogHz).
    inline float logHz (float norm, float minHz, float maxHz)
    {
        return minHz * std::pow (maxHz / minHz, clamp01 (norm));
    }

    /// Choice index from normalized value. count = number of options (spec.ts: normalizedToChoiceIndex).
    inline int choiceIndex (float norm, int count)
    {
        if (count <= 1) return 0;
        return static_cast<int> (std::lround (clamp01 (norm) * static_cast<float> (count - 1)));
    }

    /// Toggle state from normalized value. 0.5 and above is on (spec.ts: formatToggle).
    inline bool isOn (float norm)
    {
        return clamp01 (norm) >= 0.5f;
    }
}
