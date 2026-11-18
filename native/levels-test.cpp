#include "levels.hpp"
#include <cassert>
#include <iostream>

int main() {
    constexpr double rate = 48000;
    std::array<float, 480> samples{};
    const std::array<double, 3> tones{55, 850, 9000};
    for (size_t band = 0; band < tones.size(); ++band) {
        prism::Levels meter(rate);
        std::array<float, 3> energy{};
        for (int block = 0; block < 150; ++block) {
            for (size_t frame = 0; frame < samples.size(); ++frame) {
                const size_t t = block * samples.size() + frame;
                samples[frame] = .25f * std::sin(2 * std::acos(-1.) * t * tones[band] / rate);
            }
            energy = meter.read(samples.data(), samples.size());
        }
        std::cout << tones[band] << " Hz: " << energy[0] << ", " << energy[1] << ", " << energy[2] << '\n';
        for (size_t other = 0; other < energy.size(); ++other) {
            if (other != band) assert(energy[band] > energy[other] + .20f);
        }
        samples.fill(0);
        for (int block = 0; block < 200; ++block) energy = meter.read(samples.data(), samples.size());
        for (auto value : energy) assert(value < .001f);
    }
}

