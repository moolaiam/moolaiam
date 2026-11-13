#pragma once

#include <cmath>

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
}
