#include "../Source/NeuralSlot.h"
#include "../Source/MasterChain.h"
#include <cmath>
#include <cstdio>

using namespace MohitsDSP;

static int failures = 0;
static void check (bool ok, const char* what)
{
    if (! ok) { std::printf ("FAIL: %s\n", what); ++failures; }
}

// Feeds a sine wave, lets the slot settle, then returns the peak output over one more cycle-window.
// A sine is used because the DC blocker removes constant input.
static float sinePeak (NeuralSlot& slot, float amplitude, float cyclesPerSample = 0.0005f)
{
    DcBlocker dc;
    const int settle = 24000, measure = 4800;
    for (int i = 0; i < settle; ++i)
        slot.processSample (amplitude * std::sin (2.0f * 3.14159265f * cyclesPerSample * i), dc);
    float peak = 0.0f;
    for (int i = settle; i < settle + measure; ++i)
        peak = std::fmax (peak, std::fabs (slot.processSample (amplitude * std::sin (2.0f * 3.14159265f * cyclesPerSample * i), dc)));
    return peak;
}

int main()
{
    const double sr = 48000.0;

    // 1. Disabled slot passes the signal through exactly.
    {
        NeuralSlot slot;
        slot.prepare (sr);
        slot.setParams (false, 0.5f, 0.9f, true, 0.9f, 0);
        DcBlocker dc;
        bool exact = true;
        for (int i = 0; i < 4800; ++i)
        {
            const float x = std::sin (0.02f * i) * 0.8f;
            if (slot.processSample (x, dc) != x) exact = false;
        }
        check (exact, "disabled slot is bit-exact passthrough");
    }

    // 2. Zero drive, 0 dB gain, zero harmonic: near-linear for small signals.
    {
        NeuralSlot slot;
        slot.prepare (sr);
        slot.setParams (true, 0.5f, 0.0f, false, 0.0f, 0);
        const float peak = sinePeak (slot, 0.01f, 1000.0f / 48000.0f); // 1 kHz, above the DC blocker cutoff
        check (std::fabs (peak - 0.01f) < 2e-4f, "small signal is near unity with no drive");
    }

    // 3. Every type stays bounded for large input, even at maximum drive and X2.
    {
        bool bounded = true;
        for (int t = 0; t < 5; ++t)
        {
            NeuralSlot slot;
            slot.prepare (sr);
            slot.setParams (true, 1.0f, 1.0f, true, 1.0f, t);
            DcBlocker dc;
            for (int i = 0; i < 4800; ++i)
            {
                const float y = slot.processSample (std::sin (0.01f * i) * 5.0f, dc);
                if (! std::isfinite (y) || std::fabs (y) > 4.0f) bounded = false;
            }
        }
        check (bounded, "every type is finite and bounded at max drive");
    }

    // 4. Harmonic exponent adds even-harmonic asymmetry in the Tube curve.
    {
        const float asymNoBias = std::fabs (saturateStage (SaturationType::Tube, 0.5f, 0.0f)
                                            + saturateStage (SaturationType::Tube, -0.5f, 0.0f));
        const float asymBias = std::fabs (saturateStage (SaturationType::Tube, 0.5f, 0.3f)
                                          + saturateStage (SaturationType::Tube, -0.5f, 0.3f));
        check (asymNoBias < 1e-6f, "no bias gives a symmetric curve");
        check (asymBias > 1e-2f, "bias gives an asymmetric curve");
    }

    // 5. X2 changes the sound when drive is on.
    {
        NeuralSlot a, b;
        a.prepare (sr);
        b.prepare (sr);
        a.setParams (true, 0.5f, 0.5f, false, 0.0f, 0);
        b.setParams (true, 0.5f, 0.5f, true, 0.0f, 0);
        const float pa = sinePeak (a, 0.4f);
        const float pb = sinePeak (b, 0.4f);
        check (std::fabs (pa - pb) > 1e-3f, "X2 changes the output");
    }

    // 6. A DC offset from the bias is removed once settled.
    {
        NeuralSlot slot;
        slot.prepare (sr);
        slot.setParams (true, 0.5f, 0.5f, false, 1.0f, 0);
        DcBlocker dc;
        float y = 0.0f;
        for (int i = 0; i < 24000; ++i)
            y = slot.processSample (0.0f, dc);
        check (std::fabs (y) < 1e-6f, "silence stays at zero");
    }

    // 7. The chain inside the master section runs without NaN.
    {
        NeuralChain chain;
        chain.prepare (sr);
        for (int n = 0; n < 4; ++n)
            chain.slot (n).setParams (true, 0.7f, 0.6f, n == 1, 0.5f, n);
        MasterChain master;
        master.prepare (sr);
        master.setParams (0.6f, 0.5f, 1.0f, false);
        bool finite = true;
        for (int i = 0; i < 4800; ++i)
        {
            float l = std::sin (0.03f * i) * 0.5f, r = l;
            master.processSample (l, r, [&](float& a, float& b) { chain.processSample (a, b); });
            if (! std::isfinite (l) || ! std::isfinite (r)) finite = false;
        }
        check (finite, "four slots through the master chain stay finite");
    }

    std::printf (failures == 0 ? "NeuralSlot: all checks passed\n" : "NeuralSlot: %d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
