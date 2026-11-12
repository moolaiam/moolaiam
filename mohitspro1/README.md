# MOHITS PRO 1 — plugin UI

A standalone React + TypeScript front end for the MOHITS PRO 1 plugin. It has no code shared with any other project. The DSP is not part of this folder: the C++ side has to implement the host contract below.

## Run

```bash
npm install
npm run dev        # browser preview, no plugin host (meters show NO SIGNAL)
npm test           # unit tests: spec, presets, ballistics, host, A/B
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ to check the built page
```

`dist/index.html` uses relative asset paths (`base: './'`), so it can be loaded from a plugin WebView.

## Layout of the code

```
src/
  params/spec.ts       every parameter: ID, label, range, default, display format (source of truth)
  params/presets.ts    the four presets, as full snapshots
  host/host.ts         Host: coalesced writes (once per frame), gesture ordering, external changes
  host/juce.ts         JUCE WebView transport (slider relays + meter global)
  host/memory.ts       in-memory transport for the browser preview and tests
  host/index.ts        picks the transport at startup
  state/ParamContext   React context: values, control(id), applyValues(snapshot)
  state/ab.ts          A/B slots (pure logic)
  state/values.ts      diff helpers
  meters/ballistics.ts time-based dBFS meter ballistics (pure)
  ui/                  components (Knob, Meter, controls, sections, Plugin)
  styles/app.css       tokens, desktop rack layout, phone layout
tests/                 vitest unit tests
```

## Host contract (what the C++ side must provide)

**Parameters.** For every ID in `src/params/spec.ts`, register one slider relay with range **0..1** (JUCE `WebSliderRelay`). Values are normalized:

- `float`: the value itself.
- `bool`: `0` = off, `1` = on.
- `choice`: `index / (count - 1)`. For example, 5 types map to `0, 0.25, 0.5, 0.75, 1`.

The UI calls `sliderDragStarted` / `sliderDragEnded` around every gesture (drag, wheel, key press, click), so the host can group undo steps and treat touch automation correctly.

**Meters (optional).** Each frame, set `window.__MOHITS_METERS__ = { inL, inR, outL, outR }` with linear peak amplitudes (1.0 = 0 dBFS, clamped to 4.0 in the UI). If it is missing or malformed, the meters show NO SIGNAL.

**Host state.** On load, the UI reads every relay's current value. Later changes from the host (automation, state recall) update the UI through the relays' `valueChangedEvent`.

**Ranges and units.** The UI maps normalized values to display units (dB, Hz, %). The DSP maps them to real units. The `format` functions in `spec.ts` are the reference for those mappings, so change them there and in the DSP together.

## Behavior

- **Preset load, Reset and A/B switch** emit every changed parameter to the host, in one batch, so the DSP always matches the UI.
- **A/B** keeps two independent snapshots. Switching saves the live state into the slot you are leaving.
- **Modified** appears when the current state no longer matches the selected preset.
- **Knobs**: drag (Shift for fine), mouse wheel (Shift for fine), arrows / PageUp / PageDown / Home / End, double-click to reset to the parameter's own default.

## Assumptions to confirm

- Meters are shown as **Input** (left) and **Output** (right). Both are stereo. The original mock didn't say what the two sides were, so this is my reading.
- The X2 switch is shown as a plain on/off toggle with no meaning attached. Its behavior (for example 2× oversampling) must be defined in the DSP.
- The "Init" preset is the default snapshot. It replaces the old "Advanced Genesis Library Browser" name, which described nothing in the UI.
- The original decorative ring labels around the Character knob ("Warm", "Punch", …) were removed. They didn't reflect any actual state.
