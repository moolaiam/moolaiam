#include "../Source/ParamConversion.h"
#include <cstdio>
#include <cmath>

using namespace MohitsConv;

static int failures = 0;
static void check (bool ok, const char* what)
{
    if (! ok) { std::printf ("FAIL: %s\n", what); ++failures; }
}
static bool near (float a, float b, float eps = 1e-3f) { return std::fabs (a - b) < eps; }

int main()
{
    // Trim: 0.5 is 0 dB, the ends are -12 and +12 dB (matches spec.ts formatDbBipolar).
    check (near (trimDb (0.5f), 0.0f),  "trim centre is 0 dB");
    check (near (trimDb (0.0f), -12.0f), "trim bottom is -12 dB");
    check (near (trimDb (1.0f), 12.0f),  "trim top is +12 dB");
    check (near (trimLinear (0.5f), 1.0f), "trim 0 dB is unity gain");

    // Log Hz: HPF 20..1200, LPF 1500..20000 (spec.ts hpf/lpf ranges).
    check (near (logHz (0.0f, 20.0f, 1200.0f), 20.0f, 1e-2f),   "HPF min is 20 Hz");
    check (near (logHz (1.0f, 20.0f, 1200.0f), 1200.0f, 1e-1f), "HPF max is 1200 Hz");
    check (near (logHz (0.0f, 1500.0f, 20000.0f), 1500.0f, 1e-1f), "LPF min is 1500 Hz");
    check (near (logHz (1.0f, 1500.0f, 20000.0f), 20000.0f, 1e-1f), "LPF max is 20 kHz");
    // Default HPF 0.18 shows 42 Hz in the UI.
    check (std::fabs (logHz (0.18f, 20.0f, 1200.0f) - 41.8f) < 0.5f, "HPF default is about 42 Hz");

    // Choice index: rounds like spec.ts normalizedToChoiceIndex.
    check (choiceIndex (0.0f, 5) == 0,  "choice 0 of 5");
    check (choiceIndex (0.5f, 5) == 2,  "choice 2 of 5 at 0.5");
    check (choiceIndex (1.0f, 5) == 4,  "choice 4 of 5 at 1.0");
    check (choiceIndex (0.5f, 4) == 2 || choiceIndex (0.5f, 4) == 1, "4-option midpoint is adjacent");
    check (choiceIndex (0.5f, 1) == 0,  "single option is index 0");
    check (choiceIndex (1.0f / 3.0f, 4) == 1, "24dB default maps back to index 1 of 4 at 1/3");

    // Toggles: 0.5 and up is on.
    check (! isOn (0.49f), "0.49 is off");
    check (isOn (0.5f),    "0.5 is on");

    // Bad input is clamped, never NaN.
    check (clamp01 (-3.0f) == 0.0f, "clamp below 0");
    check (clamp01 (7.0f) == 1.0f,  "clamp above 1");
    check (clamp01 (std::nanf ("")) == 0.0f, "NaN becomes 0");

    std::printf (failures == 0 ? "ParamConversion: all checks passed\n" : "ParamConversion: %d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
