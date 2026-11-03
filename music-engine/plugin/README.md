# Music Engine: DAW plug-in

A VST3 / AU / Standalone instrument. You enter a prompt, the plug-in asks the generation server
for a song, and the result plays in your DAW. A MIDI note-on restarts playback, so the clip follows
the sequencer. There is also an offline path: load a WAV rendered by the CLI, so you can test
without a server.

## Status

| Check | Result |
|---|---|
| Builds on Linux (VST3, Standalone), no warnings | Verified |
| Headless tests (9 cases: playback, looping, resampling, state, client) | Pass against a mock server |
| Builds on macOS (Xcode, VST3 / AU / Standalone) | Not yet built |
| Installed and loaded in a DAW | Not yet done |

The tests use a mock of the generation API (`tests/mock_server.py`). The real server is not built yet,
so the plug-in's network path has been tested only against the mock.

## Layout

```
plugin/
  CMakeLists.txt          JUCE 8.0.4 via FetchContent; VST3 + Standalone (+ AU on macOS)
  Source/
    PluginProcessor.*     audio playback, MIDI note-on restart, state save/restore
    PluginEditor.*        prompt, duration, instrumental toggle, generate, load WAV, play/loop
    EngineClient.*        background job: POST -> poll -> download WAV -> decode
  tests/
    PluginTests.cpp       headless tests (MUSIC_ENGINE_BUILD_TESTS)
    mock_server.py        stand-in for the generation API
```

## Build on macOS

Prerequisites: CMake 3.22+ and Xcode 15+ (Command Line Tools). Run from `music-engine/plugin`:

```bash
cmake -B build -G Xcode
cmake --build build --config Release
```

The first configure downloads JUCE and takes a few minutes. Outputs:

- `build/MusicEnginePlugin_artefacts/Release/VST3/Music Engine.vst3`
- `build/MusicEnginePlugin_artefacts/Release/AU/Music Engine.component`
- `build/MusicEnginePlugin_artefacts/Release/Standalone/Music Engine.app`

## Install on macOS

```bash
cp -R "build/MusicEnginePlugin_artefacts/Release/VST3/Music Engine.vst3" ~/Library/Audio/Plug-Ins/VST3/
cp -R "build/MusicEnginePlugin_artefacts/Release/AU/Music Engine.component" ~/Library/Audio/Plug-Ins/Components/
```

Then rescan plug-ins in your DAW. Logic only loads AU, and most hosts load VST3.

Unsigned local builds usually load. If a host refuses the bundle, ad-hoc sign it:

```bash
codesign --force --deep -s - "$HOME/Library/Audio/Plug-Ins/VST3/Music Engine.vst3"
```

Nothing here has been tested on macOS yet, so treat the first install as the first real check.

## Configuration

- **Server address:** defaults to `http://localhost:8000`. It is stored in the project
  (`apiBaseUrl` on the processor). Change it in code until a settings screen exists.
- **API key:** read from the `MUSICENGINE_API_KEY` environment variable. It is never written to
  the project file. Set it in your shell profile before launching your DAW.

## Test without the server

Render a clip with the CLI, then load it in the plug-in with **Load WAV...**:

```bash
cd music-engine
PYTHONPATH=src python -m musicengine render --prompt "warm jazz at dusk" \
    --duration 20 --seed 3 --out ~/Desktop/test.wav
```

Press **Play**, or send a MIDI note.

Generation through the server returns "could not reach the server" until the API is built.

## Run the headless tests

```bash
cmake -B build -G Xcode -DMUSIC_ENGINE_BUILD_TESTS=ON
cmake --build build --config Release --target MusicEngineTests
python3 tests/mock_server.py &          # prints PORT <n>
build/MusicEngineTests_artefacts/Release/MusicEngineTests http://127.0.0.1:<n>
```

Without a URL, the server test is skipped and the playback tests still run.

## Known gaps before v0.1 is usable

1. macOS build and install (not yet done).
2. The API server is not built. Generation depends on it.
3. No settings screen for the server address or API key.
4. Clip playback is one-shot per MIDI note, with no beat or tempo sync to the host transport.
5. No code signing or notarisation for distribution.
