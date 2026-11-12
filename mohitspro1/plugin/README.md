# MOHITS PRO 1 — C++ plugin (JUCE)

This folder holds the audio side of the plugin. The UI in `../src` already talks to it through `window.__JUCE__`.

## Status

| Step | Component | State |
| --- | --- | --- |
| 1 | Parameter layer (`ParamIDs.h`, `ParameterLayout.*`, `ParamConversion.h`) | Written. The conversion header is tested here. The JUCE files still need a build on your machine. |
| 2 | State save and recall | next |
| 3 | Master chain (trims, bypass crossfade, dry/wet mix) | |
| 4 | Neural slots ×4 | |
| 5 | Oversampling and latency reporting | |
| 6 | HPF and LPF | |
| 7 | One Knob EQ | |
| 8 | Routing and M/S | |
| 9 | Level match | |
| 10 | Meters | |
| 11 | Host bridge (UI ↔ processor) | |
| 12 | Verification | |

## What step 1 gives you

- `ParamIDs.h`: the same IDs as `src/params/spec.ts`. The UI sends these exact strings.
- `ParameterLayout.cpp`: every parameter with its default, range and type. Continuous values are normalized 0..1, so the UI and the host see the same numbers.
- `ParamConversion.h`: pure C++ helpers that turn normalized values into dB, Hz and choice indices. They mirror the on-screen formatters, so the DSP and the display agree.
- `tests/ParamConversionTest.cpp`: tests for the helpers. Run them here with:

  ```bash
  g++ -std=c++17 -Wall -Wextra -Werror tests/ParamConversionTest.cpp -o /tmp/pc_test && /tmp/pc_test
  ```

## Build requirements

- JUCE 7 or newer. `ParameterLayout.cpp` uses `juce::ParameterID`, which JUCE 6 doesn't have.
- Plugin formats are not chosen yet (VST3, AU, AAX or CLAP). Set them up in your JUCE project when you create it.

## Next step on the laptop

1. Create a JUCE audio plugin project (Projucer or CMake) and add `Source/` to it.
2. Make sure `ParameterLayout.cpp` compiles. Fix any JUCE-version differences there first.
3. Build step 2 (state save and recall) on top of the layout.

## Open decisions that affect later steps

See the main `README.md` in the project root, section "Decisions to confirm". The most important ones are X2, Quality, Mix, Level Match, the meaning of Character, Tilt and Sweet Spot, and the neural type behavior.
