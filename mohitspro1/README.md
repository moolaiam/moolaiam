# MOHITS PRO 1 — plugin UI

One standalone React + TypeScript front end for the MOHITS PRO 1 plugin. It merges the best parts of the two earlier builds into a single implementation of each feature. The DSP is not in this folder: the C++ side implements the parameters listed below.

## Run

```bash
npm install
npm run dev        # browser preview (no plugin host; meters show NO SIGNAL)
npm test           # unit tests
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ to check the built page
```

`dist/` uses relative asset paths (`base: "./"`), so it can be loaded from a plugin WebView.

## What the plugin does

**Master strip:** input trim, output trim, dry/wet mix, bypass, level match, oversampling quality (1x / 2x / 4x).

**Four neural emulation slots:** each has an ON/OFF switch, gain, drive, X2, harmonic exponent, and a saturation type.

**One Knob EQ:** character, tilt, and sweet spot.

**Filters:** high pass and low pass, each with frequency, resonance, analog drive, and slope.

**Routing:** pre-EQ and post-filter switches, plus L/R or M/S channel mode.

**Meters:** stereo dBFS and VU, with time-based ballistics and peak hold. They show NO SIGNAL when the host sends no meter data.

**Presets and state:**
- Built-in presets: Advanced Genesis Library Browser (default), Clean Transparent, Vintage Warmth, Digital Edge.
- Save the current sound under a name, delete saved presets, and export or import them as `.json` files.
- A/B with independent slots. Copy A→B (or B→A) to start from the current sound.
- Revert reloads the selected preset and discards edits.
- Undo and redo, with a history of 200 steps per slot. Shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y.

**Keyboard and accessibility:** knobs take arrow keys, PageUp/PageDown, Home and End. Switches and selects are labelled. Focus rings are visible. Layout adapts at 860px and 600px.

## Code layout

```
src/
  params/spec.ts        every parameter: ID, label, range, default, display format (source of truth)
  host/bridge.ts        host adapter, coalesced per-frame writes, gesture ordering, browser adapter
  state/store.ts        PluginController: A/B, presets, user presets, undo/redo, copy, import/export
  audio/meters.ts       time-based dBFS and VU ballistics (pure)
  components/           Knob, VUMeter, MohitsPro1 (the whole plugin layout)
  styles/mohits.css     tokens, desktop rack, phone and tablet layouts
tests/                  vitest suites: spec, meters, bridge, store, producer
```

## Host contract (what the C++ side implements)

**Parameters.** Every ID in `PARAM_IDS` (`src/params/spec.ts`) is a normalized value from 0 to 1. Types:
- `continuous`: the value, shown through `format`.
- `toggle`: 0 = off, 1 = on.
- `choice`: `index / (count - 1)`, so 3 quality modes map to 0, 0.5, 1.

**Gestures.** The UI sends `beginGesture`, `setParam`, `endGesture` through `window.__JUCE__.backend.emitEvent`. Drags, wheel, keys, switches and preset loads are each wrapped in gestures, so the host can group undo steps and handle automation correctly.

**Host state → UI.** The UI reads all values on load and follows `paramChange` events from the host (automation, state recall).

**Meters.** The host provides `window.__MOHITS_HOST__` (or a meter stream on the JUCE backend) with left and right values in dBFS. Without it, the meters show NO SIGNAL.

**Parameters the DSP must implement** (new in this merge):

| ID | Type | Meaning |
| --- | --- | --- |
| `master.inputGain` | continuous | input trim, ±12 dB around 0.5 |
| `master.outputGain` | continuous | output trim, ±12 dB around 0.5 |
| `master.mix` | continuous | dry/wet, 0% to 100% (replaces the old parallel on/off) |
| `master.bypass` | toggle | bypass the whole plugin |
| `master.levelMatch` | toggle | compensate output level so bypass and processed sound compare fairly |
| `master.quality` | choice | oversampling: 1x, 2x, 4x |
| `slotN.enabled` | toggle | bypass neural slot N |

## Behavior notes

- Preset load, Revert, Reset, A/B switch, undo and redo send only the values that changed, in one batch.
- Edits made while dragging become a single undo step. A gesture that changes nothing creates no step.
- **Saved presets are stored in the browser (`localStorage`) in preview.** In the plugin, they should live in the host's state so they travel with the project. That is a host-side change.

## Decisions to confirm

- The old "Parallel Wet & Dry" on/off became a continuous **Dry / Wet Mix** (`master.mix`).
- The default preset name is still "Advanced Genesis Library Browser", as in the uploaded build.
- The decorative ring labels around the Character knob ("Warm", "Punch", …) and the "GPU Acceleration / NAM / AnalogX" footer claims were removed. They didn't reflect anything the plugin does.
- The EQ tilt knob is labelled "Tilt" instead of "One Knob EQ", so the two knobs no longer share a name.
- The meters are shown as Input and Output (left and right). The uploaded build didn't say what each side is.
