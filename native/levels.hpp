#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>

namespace prism {

// A second-order Butterworth section, evaluated without allocation on the audio thread.
struct Filter {
    double b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    Filter(double rate, double cutoff, bool highpass) {
        const double angle = 2 * std::acos(-1.0) * cutoff / rate;
        const double cosine = std::cos(angle);
        const double denominator = 1 + std::sin(angle) / std::sqrt(2.0);
        b0 = (highpass ? 1 + cosine : 1 - cosine) / (2 * denominator);
        b1 = (highpass ? -2 : 2) * b0;
        b2 = b0;
        a1 = -2 * cosine / denominator;
        a2 = 2 / denominator - 1;
    }
    double next(double x) {
        const double out = b0 * x + z1;
        z1 = b1 * x - a1 * out + z2;
        z2 = b2 * x - a2 * out;
        return out;
    }
};

class Levels {
    double sampleRate;
    Filter bass, midHighpass, midLowpass, treble;
    std::array<float, 3> smoothed{};
public:
    explicit Levels(double rate) : sampleRate(rate), bass(rate, 230, false),
        midHighpass(rate, 230, true), midLowpass(rate, 2400, false),
        treble(rate, 2400, true) {}

    std::array<float, 3> read(const float *samples, size_t frames) {
        if (!frames) return smoothed;
        std::array<double, 3> power{};
        for (size_t i = 0; i < frames; ++i) {
            const double x = std::isfinite(samples[i]) ? samples[i] : 0;
            const std::array<double, 3> split{
                bass.next(x), midLowpass.next(midHighpass.next(x)), treble.next(x)
            };
            for (size_t b = 0; b < 3; ++b) power[b] += split[b] * split[b];
        }
        const double seconds = frames / sampleRate;
        for (size_t b = 0; b < 3; ++b) {
            const double db = 10 * std::log10(std::max(1e-12, power[b] / frames));
            const double target = std::clamp((db + 56) / 50, 0., 1.);
            const double tau = target > smoothed[b] ? 0.028 : 0.15;
            smoothed[b] += (target - smoothed[b]) * (1 - std::exp(-seconds / tau));
        }
        return smoothed;
    }
};
}

