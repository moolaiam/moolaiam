import type { FilterPrefix, SlotNumber } from '../params/spec';
import { tap, useParams } from '../state/ParamContext';
import { ParamKnob, ParamSegmented, ParamSelect, ParamSlider, ParamToggle } from './controls';

// ── Neural emulation slot ──────────────────────────────────────────────────────

export function NeuralSlot({ n }: { n: SlotNumber }) {
  const { control } = useParams();
  const x2 = control(`slot${n}.x2`);
  const x2On = x2.value >= 0.5;

  return (
    <section className="panel slot" aria-label={`Neural emulation slot ${n}`}>
      <header className="slot__head">
        <span className="slot__num">{n}</span>
        <span className="slot__title">Neural emulation</span>
      </header>

      <div className="slot__body">
        <ParamKnob id={`slot${n}.gain`} label="Gain" size={44} accent="var(--cyan)" />
        <div className="slot__stack">
          <ParamKnob id={`slot${n}.drive`} label="Drive" size={44} accent="var(--amber)" />
          <div className="slot__row">
            <button
              type="button"
              className={`chip${x2On ? ' is-on' : ''}`}
              aria-pressed={x2On}
              aria-label={x2.label}
              onClick={() => tap(x2, x2On ? 0 : 1)}
            >
              X2
            </button>
            <ParamKnob id={`slot${n}.harmonic`} label="Harmonic" size={40} accent="var(--green)" />
          </div>
        </div>
      </div>

      <ParamSelect id={`slot${n}.type`} label="Type" />
    </section>
  );
}

// ── High pass / low pass filter ────────────────────────────────────────────────

export function FilterSection({ prefix, title }: { prefix: FilterPrefix; title: string }) {
  return (
    <section className="panel filter" aria-label={title}>
      <h2 className="panel__title">{title}</h2>
      <div className="filter__body">
        <ParamKnob id={`${prefix}.freq`} label="Frequency" size={50} accent="var(--cyan)" />
        <div className="filter__controls">
          <ParamSlider id={`${prefix}.res`} label="Resonance" accent="var(--cyan)" />
          <ParamSlider id={`${prefix}.drive`} label="Analog drive" accent="var(--amber)" />
          <div className="filter__slope">
            <span className="field__label">Slope</span>
            <ParamSegmented id={`${prefix}.slope`} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Character / tilt / sweet spot stage ───────────────────────────────────────

export function EqStage() {
  return (
    <section className="panel eq" aria-label="EQ">
      <ParamKnob id="eq.character" label="Character" size={80} accent="var(--amber)" />
      <ParamKnob id="eq.tilt" label="Tilt" size={92} accent="var(--cyan)" ticks />
      <ParamKnob id="eq.sweetSpot" label="Sweet spot" size={84} accent="var(--amber)" ticks />
    </section>
  );
}

// ── Routing sidebar ───────────────────────────────────────────────────────────

export function RoutingPanel() {
  return (
    <section className="panel routing" aria-label="Routing">
      <h2 className="panel__title">Routing</h2>
      <ParamToggle id="route.preEq" label="Pre EQ" />
      <ParamToggle id="route.postFilters" label="Post filters" />
      <ParamToggle id="route.parallel" label="Parallel mix" />
      <div className="routing__group">
        <span className="field__label">Stereo</span>
        <ParamSegmented id="route.stereo" />
      </div>
    </section>
  );
}
