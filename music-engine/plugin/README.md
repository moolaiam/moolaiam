# Music Engine: DAW plug-in

A VST3 / AU / Standalone instrument. You enter a prompt, the plug-in asks the generation server
for a song, and the result plays in your DAW. A MIDI note-on restarts playback, so the clip follows
the sequencer. There is also an offline path: load a WAV rendered by the CLI, so you can test
without a server.

**Status: scaffold, not yet built.** The code was written in a sandbox without JUCE or an audio
toolchain, so it has not been compiled. The first build on your machine will likely surface small
fixes. Treat the first compile as the first milestone.

## What's here

```
plugin/
  CMakeLists.txt          JUCE 8 via FetchContent, VST3 + AU + Standalone
  Source/
    PluginProcessor.*     audio playback, MIDI note-on restart, state save/restore
    PluginEditor.*        prompt, duration, instrumental toggle, generate, load WAV, play/loop
    EngineClient.*        background job: POST -> poll -> download WAV -> decode
```

## Prerequisites (your computer)

- CMake 3.22 or newer
- git
- **macOS:** Xcode 15 or newer (Command Line Tools)
- **Windows:** Visual Studio 2022 with the "Desktop development with C++" workload

Check the JUCE tag in `CMakeLists.txt` (`GIT_TAG 8.0.4`) against
https://github.com/juce-framework/JUCE/tags and update it if needed.

## Build

From the repository root:

```bash
cd music-engine/plugin

# macOS
cmake -B build -G Xcode
cmake --build build --config Release

# Windows (PowerShell)
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

The first configure downloads JUCE, which takes a few minutes. Outputs go to
`build/MusicEnginePlugin_artefacts/Release/` (VST3, AU, Standalone).

Install the VST3 by copying `MusicEngine.vst3` into your system's VST3 folder
(`/Library/Audio/Plug-Ins/VST3` on macOS, `C:\Program Files\Common Files\VST3` on Windows).
Rescan plug-ins in your DAW.

## Configuration

- **Server address:** defaults to `http://localhost:8000`. It is stored in the project
  (`apiBaseUrl` on the processor). Change it in code until a settings screen exists.
- **API key:** read from the `MUSICENGINE_API_KEY` environment variable. It is never written to
  the project file. Set it in your shell profile before launching your DAW.

## Test without the server

```bash
cd music-engine
PYTHONPATH=src python -m musicengine render --prompt "warm jazz at dusk" \
    --duration 20 --seed 3 --out ~/Desktop/test.wav
```

Then in the plug-in, click **Load WAV...** and pick the file. Press **Play**, or send a MIDI note.

Note: the rendered clips come from the reference components, so they are not representative of
a trained model. The server endpoints in `docs/api/openapi.yaml` are also not implemented yet.
Generate calls will fail with a "could not reach the server" message until the API is built.

## Known gaps before v0.1 is usable

1. First compile and fix whatever it reveals (no toolchain was available when this was written).
2. The API server is not built. Generation depends on it.
3. No settings screen for the server address or API key.
4. Clip playback is one-shot, with no beat or tempo sync to the host transport.
5. No automated tests for the plug-in. The plan is a JUCE unit-test target for the playback and
   resampling code, plus a headless host test.
6. No code signing or notarisation. macOS will refuse unsigned AU/VST3 bundles until that is done.

## Next steps when you're at your computer

1. `cmake -B build ...` and `cmake --build build` as above. Send me any compiler errors.
2. Load the Standalone build with a rendered WAV to check audio playback.
3. Load the VST3 in your DAW and confirm MIDI note-on restarts playback.
