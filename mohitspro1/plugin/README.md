# MOHITS PRO 1 — C++ plugin (JUCE)

Builds the plugin from a terminal with CMake. No Projucer or manual project setup is needed. JUCE 7.0.12 is downloaded automatically.

## Build (macOS)

Requires Xcode (with command line tools) and CMake 3.22 or newer.

```bash
cd mohitspro1/plugin
cmake -B build -G Xcode
cmake --build build --config Release --target MohitsPro1_Standalone   # the app, for testing
cmake --build build --config Release --target MohitsPro1_VST3         # the DAW plugin
cmake --build build --config Release --target MohitsPro1_AU           # Logic / GarageBand
```

The Standalone app is in `build/MohitsPro1_artefacts/Release/Standalone/`. Open it first to confirm the plugin runs.

The VST3 and AU plugins go into the usual system folders when you copy them there (or when you run the install step your DAW uses). `COPY_PLUGIN_AFTER_BUILD` is off, so copy them yourself: `~/Library/Audio/Plug-Ins/VST3/` and `~/Library/Audio/Plug-Ins/Components/`.

## Status

| Step | Component | State |
| --- | --- | --- |
| 1 | Parameter layer (`ParamIDs.h`, `ParameterLayout.*`, `ParamConversion.h`) | Written. Build on your Mac. |
| 2 | State save and recall | Written in `PluginProcessor.cpp` (APVTS XML). Build on your Mac. |
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

## Honest status of what's been compiled

- `ParamConversion.h` and its tests: compiled and passing with g++ in the development container.
- `CMakeLists.txt`, `PluginProcessor.*`, `PluginEditor.*`, `ParameterLayout.*`: written but **not yet compiled**. The development container can't download JUCE, so the first real build is on your Mac. If it fails, paste the first error.

## Open decisions that affect later steps

See the main `README.md` in the project root, section "Decisions to confirm". The most important ones are X2, Quality, Mix, Level Match, the meaning of Character, Tilt and Sweet Spot, and the neural type behavior.
