#include "../Source/MasterChain.h"
#include <cmath>
#include <cstdio>

using namespace MohitsDSP;

static int failures = 0;
static void check (bool ok, const char* what)
{
    if (! ok) { std::printf ("FAIL: %s\n", what); ++failures; }
}
static bool near (float a, float b, float eps) { return std::fabs (a - b) < eps; }

// Feeds the same constant input for many samples, so smoothing settles.
// The input is never fed back from the output.
static void settle (MasterChain& c, float input, int samples)
{
    for (int i = 0; i < samples; ++i)
    {
        float l = input, r = input;
        c.processSample (l, r);
    }
}

// One sample of constant input, after settling. Returns the output.
static void sampleOnce (MasterChain& c, float input, float& outL, float& outR)
{
    outL = input;
    outR = input;
    c.processSample (outL, outR);
}

int main()
{
    const double sr = 48000.0;
    const int settleSamples = 24000; // 500 ms, about 25 time constants

    // 1. Defaults (trims 0 dB, mix 100%, bypass off) pass the signal through bit-exact.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.5f, 0.5f, 1.0f, false);
        bool exact = true;
        for (int i = 0; i < 4800; ++i)
        {
            float l = std::sin (0.01f * i) * 0.7f;
            float r = std::cos (0.013f * i) * 0.5f;
            const float l0 = l, r0 = r;
            c.processSample (l, r);
            if (l != l0 || r != r0) exact = false;
        }
        check (exact, "defaults are bit-exact passthrough");
    }

    // 2. Bypass returns the exact dry input once settled.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.9f, 0.1f, 1.0f, true); // trims moved, but bypassed
        settle (c, 0.3f, settleSamples);
        float l = 0.0f, r = 0.0f;
        sampleOnce (c, 0.3f, l, r);
        check (l == 0.3f && r == 0.3f, "bypass gives exact dry signal");
    }

    // 3. Mix at 0% is the dry signal, even with trims set.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.9f, 0.9f, 0.0f, false);
        settle (c, 0.25f, settleSamples);
        float l = 0.0f, r = 0.0f;
        sampleOnce (c, 0.25f, l, r);
        check (l == 0.25f && r == 0.25f, "mix 0% is exact dry");
    }

    // 4. Input trim +12 dB scales the wet path by about 4x (mix 100%, output 0 dB).
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (1.0f, 0.5f, 1.0f, false);
        settle (c, 0.1f, settleSamples);
        float l = 0.0f, r = 0.0f;
        sampleOnce (c, 0.1f, l, r);
        check (near (l, 0.1f * 3.981f, 0.001f), "input +12 dB is about 4x");
    }

    // 5. Output trim -12 dB scales the output by about 1/4.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.5f, 0.0f, 1.0f, false);
        settle (c, 0.4f, settleSamples);
        float l = 0.0f, r = 0.0f;
        sampleOnce (c, 0.4f, l, r);
        check (near (l, 0.4f / 3.981f, 0.001f), "output -12 dB is about 1/4");
    }

    // 6. Parameter changes are smoothed, not stepped. The first sample after a
    //    big input change is still close to the old level.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.5f, 0.5f, 1.0f, false);
        settle (c, 0.5f, 1000);
        c.setParams (1.0f, 0.5f, 1.0f, false); // jump input to +12 dB
        float l = 0.0f, r = 0.0f;
        sampleOnce (c, 0.5f, l, r);
        check (near (l, 0.5f, 0.01f), "input change is smoothed on the first sample");
    }

    // 7. Bypass crossfades, so the output never jumps by a large amount in one sample.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (1.0f, 0.5f, 1.0f, false); // processed path is about 4x
        settle (c, 0.2f, settleSamples);
        c.setParams (1.0f, 0.5f, 1.0f, true);  // now bypass
        float prev = 0.0f;
        float largestStep = 0.0f;
        for (int i = 0; i < 4800; ++i)
        {
            float x = 0.2f, y = 0.2f;
            c.processSample (x, y);
            if (i > 0) largestStep = std::fmax (largestStep, std::fabs (x - prev));
            prev = x;
        }
        // Full change is about 0.6 over 20 ms (960 samples), so no single sample should
        // move more than a small fraction of that.
        check (largestStep < 0.01f, "bypass crossfade has no sudden jump");
    }

    // 8. Unusual input never produces NaN or infinity.
    {
        MasterChain c;
        c.prepare (sr);
        c.setParams (0.5f, 0.5f, 1.0f, false);
        float l = 1.0e30f, r = -1.0e30f;
        c.processSample (l, r);
        check (std::isfinite (l) && std::isfinite (r), "large input stays finite");

        c.setParams (0.5f, 0.5f, std::nanf (""), false); // bad mix value
        float x = 0.0f, y = 0.0f;
        sampleOnce (c, 0.3f, x, y);
        check (std::isfinite (x) && std::isfinite (y), "NaN mix value stays finite");
    }

    std::printf (failures == 0 ? "MasterChain: all checks passed\n" : "MasterChain: %d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
