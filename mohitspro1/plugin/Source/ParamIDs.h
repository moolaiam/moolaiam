#pragma once

// Parameter IDs. These must match PARAM_IDS in src/params/spec.ts exactly,
// because the UI sends and receives these strings.
namespace MohitsIDs
{
    inline constexpr const char* inputGain    = "master.inputGain";
    inline constexpr const char* outputGain   = "master.outputGain";
    inline constexpr const char* mix          = "master.mix";
    inline constexpr const char* bypass       = "master.bypass";
    inline constexpr const char* levelMatch   = "master.levelMatch";
    inline constexpr const char* quality      = "master.quality";

    inline constexpr const char* slotEnabled[4]    = { "slot1.enabled",     "slot2.enabled",     "slot3.enabled",     "slot4.enabled" };
    inline constexpr const char* slotGain[4]       = { "slot1.gain",        "slot2.gain",        "slot3.gain",        "slot4.gain" };
    inline constexpr const char* slotDrive[4]      = { "slot1.drive",       "slot2.drive",       "slot3.drive",       "slot4.drive" };
    inline constexpr const char* slotX2[4]         = { "slot1.x2",          "slot2.x2",          "slot3.x2",          "slot4.x2" };
    inline constexpr const char* slotHarmonic[4]   = { "slot1.harmonicExp", "slot2.harmonicExp", "slot3.harmonicExp", "slot4.harmonicExp" };
    inline constexpr const char* slotType[4]       = { "slot1.type",        "slot2.type",        "slot3.type",        "slot4.type" };

    inline constexpr const char* eqCharacter  = "eq.character";
    inline constexpr const char* eqTilt       = "eq.tilt";
    inline constexpr const char* eqSweetSpot  = "eq.sweetSpot";

    inline constexpr const char* hpfFreq      = "hpf.freq";
    inline constexpr const char* hpfResonance = "hpf.resonance";
    inline constexpr const char* hpfDrive     = "hpf.drive";
    inline constexpr const char* hpfSlope     = "hpf.slope";

    inline constexpr const char* lpfFreq      = "lpf.freq";
    inline constexpr const char* lpfResonance = "lpf.resonance";
    inline constexpr const char* lpfDrive     = "lpf.drive";
    inline constexpr const char* lpfSlope     = "lpf.slope";

    inline constexpr const char* preEq        = "routing.preEq";
    inline constexpr const char* postFilters  = "routing.postFilters";
    inline constexpr const char* channelMode  = "routing.channelMode";
}
