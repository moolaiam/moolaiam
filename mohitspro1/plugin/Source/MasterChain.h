#pragma once

// Pure C++ (no JUCE). Master section of the processor: input trim, output trim,
// dry/wet mix and bypass. The processing between the trims is passed in as a function,
// so the neural slots, filters and EQ plug in there without changing this file.

#include <cmath>
#include "ParamConversion.h"
#include "Smoothed.h"

namespace MohitsDSP
{
    class MasterChain
    {
    public:
        static constexpr double smoothingSeconds = 0.02; // 20 ms for every control

        void prepare (double sampleRate)
        {
            inputGain.reset    (sampleRate, smoothingSeconds, 1.0f);
            outputGain.reset   (sampleRate, smoothingSeconds, 1.0f);
            mix.reset          (sampleRate, smoothingSeconds, 1.0f);
            bypassAmount.reset (sampleRate, smoothingSeconds, 0.0f);
        }

        /// Normalized 0..1 values, the same numbers the UI and host use.
        void setParams (float inputNorm, float outputNorm, float mixNorm, bool bypassed)
        {
            inputGain.setTarget    (MohitsConv::trimLinear (inputNorm));
            outputGain.setTarget   (MohitsConv::trimLinear (outputNorm));
            mix.setTarget          (MohitsConv::clamp01 (mixNorm));
            bypassAmount.setTarget (bypassed ? 1.0f : 0.0f);
        }

        /// Processes one mono sample in place. `processWet` runs on the signal between the trims.
        template <typename WetFn>
        void processMonoSample (float& sample, WetFn&& processWet)
        {
            const float gIn  = inputGain.next();
            const float gOut = outputGain.next();
            const float m    = mix.next();
            const float b    = bypassAmount.next(); // 1 = fully bypassed

            const float dry = sample;
            float wet = dry * gIn;
            processWet (wet);
            wet *= gOut;

            const float mixed = dry * (1.0f - m) + wet * m;
            sample = dry * b + mixed * (1.0f - b);
        }

        void processMonoSample (float& sample)
        {
            processMonoSample (sample, [](float&) {});
        }

        /// Processes one stereo sample in place. `processWet` runs on the signal between the trims.
        template <typename WetFn>
        void processSample (float& left, float& right, WetFn&& processWet)
        {
            const float gIn  = inputGain.next();
            const float gOut = outputGain.next();
            const float m    = mix.next();
            const float b    = bypassAmount.next(); // 1 = fully bypassed

            const float dryL = left;
            const float dryR = right;

            float wetL = dryL * gIn;
            float wetR = dryR * gIn;
            processWet (wetL, wetR);

            wetL *= gOut;
            wetR *= gOut;

            // Dry/wet mix. With mix = 1 this is exactly the wet signal.
            const float mixedL = dryL * (1.0f - m) + wetL * m;
            const float mixedR = dryR * (1.0f - m) + wetR * m;

            // Bypass crossfade. When fully bypassed this is exactly the dry input.
            left  = dryL * b + mixedL * (1.0f - b);
            right = dryR * b + mixedR * (1.0f - b);
        }

        void processSample (float& left, float& right)
        {
            processSample (left, right, [](float&, float&) {});
        }

    private:
        Smoothed inputGain;
        Smoothed outputGain;
        Smoothed mix;
        Smoothed bypassAmount;
    };
}
