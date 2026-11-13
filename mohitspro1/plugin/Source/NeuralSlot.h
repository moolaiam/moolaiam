#pragma once

// Pure C++ (no JUCE). The four neural emulation slots (step 4).
// Each slot: input gain, drive, a saturation curve for its type, an even-harmonic bias,
// and a DC blocker. X2 runs the curve a second time.
//
// Defaults chosen without the sound designer's input (to confirm by ear):
//   - Drive 0..100% maps to 1x..10x input into the curve.
//   - Harmonic exponent 0..100% maps to an asymmetry bias of 0..0.3 (even harmonics).
//   - X2 runs the saturation curve twice.

#include <algorithm>
#include <array>
#include <cmath>
#include "ParamConversion.h"
#include "Smoothed.h"

namespace MohitsDSP
{
    enum class SaturationType : int
    {
        Tube = 0,       // tanh: smooth, warm
        Transformer,    // arctan: rounder knee
        Tape,           // cubic soft clip
        Console,        // scaled tanh with a wider linear range
        SolidState      // sharp knee, closest to a hard clip
    };

    /// Saturation curve. Roughly unity slope near zero, bounded for large inputs.
    inline float saturate (SaturationType type, float x)
    {
        switch (type)
        {
            case SaturationType::Tube:        return std::tanh (x);
            case SaturationType::Transformer: return std::atan (x);
            case SaturationType::Tape:
            {
                const float c = std::clamp (x, -1.5f, 1.5f);
                return c - c * c * c / 6.75f;
            }
            case SaturationType::Console:     return 1.43f * std::tanh (0.7f * x);
            case SaturationType::SolidState:
            {
                const float a = x * x;
                return x / std::sqrt (std::sqrt (1.0f + a * a));
            }
        }
        return x;
    }

    /// One stage of saturation with an even-harmonic bias. The bias is removed from the
    /// output, so silence stays at zero.
    inline float saturateStage (SaturationType type, float x, float bias)
    {
        return saturate (type, x + bias) - saturate (type, bias);
    }

    /// Removes DC offset, which the bias can add. One per channel per slot.
    struct DcBlocker
    {
        float x1 = 0.0f;
        float y1 = 0.0f;

        float process (float x)
        {
            const float y = x - x1 + 0.995f * y1;
            x1 = x;
            y1 = y;
            return y;
        }
    };

    class NeuralSlot
    {
    public:
        void prepare (double sampleRate)
        {
            gain.reset (sampleRate, 0.02, 1.0f);
            drive.reset (sampleRate, 0.02, 1.0f);
            harmonic.reset (sampleRate, 0.02, 0.0f);
        }

        /// Normalized 0..1 values, the same numbers the UI and host use.
        void setParams (bool isEnabled, float gainNorm, float driveNorm, bool isX2,
                        float harmonicNorm, int typeIndex)
        {
            enabled = isEnabled;
            x2 = isX2;
            type = static_cast<SaturationType> (std::clamp (typeIndex, 0, 4));
            gain.setTarget (MohitsConv::trimLinear (gainNorm));
            drive.setTarget (1.0f + 9.0f * MohitsConv::clamp01 (driveNorm));
            harmonic.setTarget (0.3f * MohitsConv::clamp01 (harmonicNorm));
        }

        /// Processes one sample of one channel. `dc` is that channel's DC blocker.
        float processSample (float x, DcBlocker& dc)
        {
            const float g = gain.next();
            const float d = drive.next();
            const float bias = harmonic.next();

            if (! enabled)
                return x;

            float y = saturateStage (type, x * g * d, bias);
            if (x2)
                y = saturateStage (type, y, bias);

            return dc.process (y);
        }

    private:
        bool enabled = true;
        bool x2 = false;
        SaturationType type = SaturationType::Tube;
        Smoothed gain;
        Smoothed drive;
        Smoothed harmonic;
    };

    /// The four slots in series. Channel state is kept per slot and per channel.
    class NeuralChain
    {
    public:
        static constexpr int slotCount = 4;

        void prepare (double sampleRate)
        {
            for (auto& slot : slots)
                slot.prepare (sampleRate);
            dcLeft = {};
            dcRight = {};
        }

        NeuralSlot& slot (int index) { return slots[static_cast<size_t> (index)]; }

        void processSample (float& left, float& right)
        {
            for (int n = 0; n < slotCount; ++n)
            {
                left  = slots[n].processSample (left,  dcLeft[n]);
                right = slots[n].processSample (right, dcRight[n]);
            }
        }

        void processMono (float& sample)
        {
            for (int n = 0; n < slotCount; ++n)
                sample = slots[n].processSample (sample, dcLeft[n]);
        }

    private:
        std::array<NeuralSlot, slotCount> slots;
        std::array<DcBlocker, slotCount> dcLeft;
        std::array<DcBlocker, slotCount> dcRight;
    };
}
