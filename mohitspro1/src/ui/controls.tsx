import { SPEC, choiceIndex, choiceValue, type ParamId } from '../params/spec';
import { tap, useParams } from '../state/ParamContext';
import { Knob } from './Knob';

// ── Param-bound controls. Each one reads and writes through the param context. ──

interface KnobByIdProps {
  id: ParamId;
  label: string;
  size?: number;
  accent: string;
  ticks?: boolean;
}

export function ParamKnob({ id, label, size, accent, ticks }: KnobByIdProps) {
  const { control } = useParams();
  const c = control(id);
  return (
    <Knob
      label={label}
      ariaLabel={c.label}
      value={c.value}
      defaultValue={c.defaultValue}
      format={c.format}
      accent={accent}
      size={size}
      ticks={ticks}
      onChange={c.set}
      onBegin={c.begin}
      onEnd={c.end}
    />
  );
}

export function ParamSlider({ id, label, accent }: { id: ParamId; label: string; accent: string }) {
  const { control } = useParams();
  const c = control(id);
  const navKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
  return (
    <label className="slider">
      <span className="slider__label">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        aria-label={c.label}
        aria-valuetext={c.format(c.value)}
        value={c.value}
        style={{ accentColor: accent }}
        onPointerDown={c.begin}
        onPointerUp={c.end}
        onPointerCancel={c.end}
        onKeyDown={(e) => {
          if (!e.repeat && navKeys.has(e.key)) c.begin();
        }}
        onKeyUp={(e) => {
          if (navKeys.has(e.key)) c.end();
        }}
        onChange={(e) => c.set(Number(e.target.value))}
      />
      <output className="slider__value">{c.format(c.value)}</output>
    </label>
  );
}

export function ParamToggle({ id, label }: { id: ParamId; label: string }) {
  const { control } = useParams();
  const c = control(id);
  const on = c.value >= 0.5;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={c.label}
      className={`toggle${on ? ' is-on' : ''}`}
      onClick={() => tap(c, on ? 0 : 1)}
    >
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
    </button>
  );
}

export function ParamSelect({ id, label }: { id: ParamId; label: string }) {
  const { control } = useParams();
  const c = control(id);
  const options = SPEC[id].options ?? [];
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        aria-label={c.label}
        value={choiceIndex(options.length, c.value)}
        onChange={(e) => tap(c, choiceValue(options.length, Number(e.target.value)))}
      >
        {options.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Generic segmented control (role=radiogroup, aria-checked on each option) ──

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`segmented ${className ?? ''}`}>
      {options.map((o) => {
        const checked = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={checked}
            className={`segmented__opt${checked ? ' is-on' : ''}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control bound to a choice param. */
export function ParamSegmented({ id }: { id: ParamId }) {
  const { control } = useParams();
  const c = control(id);
  const options = SPEC[id].options ?? [];
  const current = options[choiceIndex(options.length, c.value)];
  return (
    <Segmented
      label={c.label}
      options={options}
      value={current}
      onChange={(opt) => tap(c, choiceValue(options.length, options.indexOf(opt)))}
    />
  );
}
