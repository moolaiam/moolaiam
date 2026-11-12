#pragma once

// Pure C++ (no JUCE). Master section of the processor: input trim, output trim,
// dry/wet mix and bypass. The neural slots, filters and EQ go between the trims
// in later steps; the marked spot below is where they plug in.

#include <cmath>
#include "ParamConversion.h"

namespace MohitsDSP
{
    /// One-pole smoother. Moves toward its target with the given time constant and
    /// snaps to the target once it is close enough, so settled values are exact.
    class Smoothed
    {
    public:
        void reset (double sampleRate, double timeSec, float initial)
        {
            coeff = timeSec > 0.0 ? static_cast<float> (std::exp (-1.0 / (sampleRate * timeSec))) : 0.0f;
            current = target = initial;
        }

        void setTarget (float newTarget) { target = newTarget; }

        float next()
        {
            current = target + (current - target) * coeff;
            if (std::fabs (current - target) < 1.0e-6f)
                current = target;
            return current;
        }

    private:
        float coeff = 0.0f;
        float current = 0.0f;
        float target = 0.0f;
    };

    class MasterChain
    {
    public:
        static constexpr double smoothingSeconds = 0.02; // 20 ms for every control

        void prepare (double sampleRate)
        {
            inputGain.reset  (sampleRate, smoothingSeconds, 1.0f);
            outputGain.reset (sampleRate, smoothingSeconds, 1.0f);
            mix.reset        (sampleRate, smoothingSeconds, 1.0f);
            bypassAmount.reset (sampleRate, smoothingSeconds, 0.0f);
        }

        /// Normalized 0..1 values, the same numbers the UI and host use.
        void setParams (float inputNorm, float outputNorm, float mixNorm, bool bypassed)
        {
            inputGain.setTarget (MohitsConv::trimLinear (inputNorm));
            outputGain.setTarget (MohitsConv::trimLinear (outputNorm));
            mix.setTarget (MohitsConv::clamp01 (mixNorm));
            bypassAmount.setTarget (bypassed ? 1.0f : 0.0f);
        }

        /// Processes one stereo sample in place.
        void processSample (float& left, float& right)
        {
            const float gIn = inputGain.next();
            const float gOut = outputGain.next();
            const float m = mix.next();
            const float b = bypassAmount.next(); // 1 = fully bypassed

            const float dryL = left;
            const float dryR = right;

            float wetL = dryL * gIn;
            float wetR = dryR * gIn;

            // ── Processing chain goes here (steps 4 to 8) ──────────────────────
            // wetL / wetR are processed by the neural slots, EQ and filters.

            wetL *= gOut;
            wetR *= gOut;

            // Dry/wet mix. With mix = 1 this is exactly the wet signal.
            const float mixedL = dryL * (1.0f - m) + wetL * m;
            const float mixedR = dryR * (1.0f - m) + wetR * m;

            // Bypass crossfade. When fully bypassed this is exactly the dry input.
            left  = dryL * b + mixedL * (1.0f - b);
            right = dryR * b + mixedR * (1.0f - b);
        }

    private:
        Smoothed inputGain;
        Smoothed outputGain;
        Smoothed mix;
        Smoothed bypassAmount;
    };
}
