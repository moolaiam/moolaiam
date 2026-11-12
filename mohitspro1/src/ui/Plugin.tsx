import { useState } from 'react';
import { PRESETS, presetValues, type PresetId } from '../params/presets';
import { valuesEqual } from '../state/values';
import { createAB, switchAB, type ABState, type Slot } from '../state/ab';
import { useParams } from '../state/ParamContext';
import { Meter } from './Meter';
import { Segmented } from './controls';
import { EqStage, FilterSection, NeuralSlot, RoutingPanel } from './sections';

const SLOTS: Slot[] = ['A', 'B'];

export function Plugin() {
  const { host, values, applyValues } = useParams();

  const [presetId, setPresetId] = useState<PresetId>('init');
  const [ab, setAB] = useState<ABState>(() => createAB(values));

  const presetSnapshot = presetValues(presetId);
  const modified = !valuesEqual(values, presetSnapshot);

  const choosePreset = (id: PresetId) => {
    setPresetId(id);
    applyValues(presetValues(id));
  };

  const resetToPreset = () => applyValues(presetValues(presetId));

  const selectSlot = (slot: Slot) => {
    if (slot === ab.active) return;
    const { state, next } = switchAB(ab, values);
    setAB(state);
    applyValues(next);
  };

  return (
    <div className="plugin">
      <header className="topbar">
        <div className="brand">MOHITS</div>

        <div className="topbar__controls">
          <label className="field field--preset">
            <span className="sr-only">Preset</span>
            <select value={presetId} onChange={(e) => choosePreset(e.target.value as PresetId)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {modified && <span className="badge" role="status">Modified</span>}

          <Segmented<Slot> label="A/B slot" options={SLOTS} value={ab.active} onChange={selectSlot} className="ab" />

          <button type="button" className="btn" onClick={resetToPreset} disabled={!modified}>
            Reset to preset
          </button>
        </div>

        <div className="brand brand--right">
          PRO <span className="accent">1</span>
        </div>
      </header>

      <main className="rack">
        <div className="rack__in">
          <Meter title="Input" source="in" />
        </div>

        <div className="rack__center">
          <div className="slots">
            {([1, 2, 3, 4] as const).map((n) => (
              <NeuralSlot key={n} n={n} />
            ))}
          </div>
          <EqStage />
          <div className="filters">
            <FilterSection prefix="hpf" title="High pass" />
            <FilterSection prefix="lpf" title="Low pass" />
          </div>
        </div>

        <div className="rack__side">
          <RoutingPanel />
        </div>

        <div className="rack__out">
          <Meter title="Output" source="out" />
        </div>
      </main>

      <footer className="statusbar">
        <span>Host: {host.transportName === 'juce' ? 'JUCE' : 'Preview (no plugin host)'}</span>
        <span>Active slot: {ab.active}</span>
      </footer>
    </div>
  );
}
