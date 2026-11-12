import { clamp01 } from '../util';

/**
 * Single source of truth for every parameter the UI controls.
 *
 * Every value is normalized to 0..1, which is what the host stores and automates:
 *   - float:  the value itself, displayed through `format`
 *   - bool:   0 = off, 1 = on
 *   - choice: index / (count - 1), so choice 0 = 0.0 and last choice = 1.0
 *
 * The host side must register one 0..1 slider relay per ID below (see README).
 */

export const SLOT_TYPES = ['Tube', 'Transformer', 'Tape', 'Console', 'Solid State'] as const;
export const SLOPES = ['6dB', '12dB', '24dB', '48dB'] as const;
export const STEREO_MODES = ['LR', 'MS'] as const;

export type SlotType = (typeof SLOT_TYPES)[number];
export type Slope = (typeof SLOPES)[number];
export type StereoMode = (typeof STEREO_MODES)[number];

export type SlotNumber = 1 | 2 | 3 | 4;
export type FilterPrefix = 'hpf' | 'lpf';

export type ParamId =
  | `slot${SlotNumber}.${'gain' | 'drive' | 'harmonic' | 'x2' | 'type'}`
  | `eq.${'character' | 'tilt' | 'sweetSpot'}`
  | `${FilterPrefix}.${'freq' | 'res' | 'drive' | 'slope'}`
  | `route.${'preEq' | 'postFilters' | 'parallel' | 'stereo'}`;

export type Values = Record<ParamId, number>;

export interface SlotSettings {
  gain: number;
  drive: number;
  x2: boolean;
  harmonic: number;
  type: SlotType;
}

export interface FilterSettings {
  freq: number;
  res: number;
  drive: number;
  slope: Slope;
}

export type ParamKind = 'float' | 'bool' | 'choice';

export interface ParamSpec {
  id: ParamId;
  label: string;
  kind: ParamKind;
  /** Normalized default, 0..1. */
  default: number;
  /** Choice labels, for kind === 'choice'. */
  options?: readonly string[];
  format: (v: number) => string;
}

// ── Discrete helpers ───────────────────────────────────────────────────────────

export function choiceIndex(count: number, v: number): number {
  return Math.round(clamp01(v) * (count - 1));
}

export function choiceValue(count: number, index: number): number {
  return count <= 1 ? 0 : index / (count - 1);
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const pct = (v: number): string => `${Math.round(clamp01(v) * 100)}%`;

/** Gain is stored 0..1 and displayed as -12..+12 dB around 0.5. */
const gainDb = (v: number): string => {
  const d = (clamp01(v) - 0.5) * 24;
  const r = Math.abs(d) < 0.05 ? 0 : d;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`;
};

/** Log-mapped frequency, so 0..1 sweeps evenly per octave. */
const hzFormat =
  (min: number, max: number) =>
  (v: number): string => {
    const hz = min * Math.pow(max / min, clamp01(v));
    return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
  };

// ── Spec builders ──────────────────────────────────────────────────────────────

const float = (id: ParamId, label: string, def: number, format: (v: number) => string): ParamSpec => ({
  id,
  label,
  kind: 'float',
  default: def,
  format,
});

const bool = (id: ParamId, label: string, def: boolean): ParamSpec => ({
  id,
  label,
  kind: 'bool',
  default: def ? 1 : 0,
  format: (v) => (clamp01(v) >= 0.5 ? 'On' : 'Off'),
});

const choice = (
  id: ParamId,
  label: string,
  options: readonly string[],
  defIndex: number,
): ParamSpec => ({
  id,
  label,
  kind: 'choice',
  options,
  default: choiceValue(options.length, defIndex),
  format: (v) => options[choiceIndex(options.length, v)],
});

// ── Defaults (musical starting point, mirrors the original mock's values) ─────

export const SLOT_DEFAULTS: Record<SlotNumber, SlotSettings> = {
  1: { gain: 0.52, drive: 0.35, x2: false, harmonic: 0.45, type: 'Tube' },
  2: { gain: 0.48, drive: 0.42, x2: true, harmonic: 0.55, type: 'Transformer' },
  3: { gain: 0.55, drive: 0.3, x2: false, harmonic: 0.4, type: 'Tape' },
  4: { gain: 0.5, drive: 0.5, x2: false, harmonic: 0.6, type: 'Console' },
};

export const FILTER_DEFAULTS: Record<FilterPrefix, FilterSettings> = {
  hpf: { freq: 0.18, res: 0.25, drive: 0.2, slope: '24dB' },
  lpf: { freq: 0.82, res: 0.25, drive: 0.2, slope: '24dB' },
};

export const EQ_DEFAULTS = { character: 0.5, tilt: 0.5, sweetSpot: 0.65 } as const;

/** Frequency sweep ranges in Hz. HPF and LPF are separate, so the UI doesn't cross them. */
export const FILTER_RANGE_HZ: Record<FilterPrefix, readonly [number, number]> = {
  hpf: [20, 1200],
  lpf: [1500, 20000],
};

// ── Parameter table ────────────────────────────────────────────────────────────

const slotSpecs = (n: SlotNumber): ParamSpec[] => {
  const d = SLOT_DEFAULTS[n];
  return [
    float(`slot${n}.gain`, `Slot ${n} gain`, d.gain, gainDb),
    float(`slot${n}.drive`, `Slot ${n} drive`, d.drive, pct),
    float(`slot${n}.harmonic`, `Slot ${n} harmonic exponent`, d.harmonic, pct),
    bool(`slot${n}.x2`, `Slot ${n} X2`, d.x2),
    choice(`slot${n}.type`, `Slot ${n} type`, SLOT_TYPES, SLOT_TYPES.indexOf(d.type)),
  ];
};

const filterSpecs = (p: FilterPrefix): ParamSpec[] => {
  const d = FILTER_DEFAULTS[p];
  const [lo, hi] = FILTER_RANGE_HZ[p];
  const name = p.toUpperCase();
  return [
    float(`${p}.freq`, `${name} frequency`, d.freq, hzFormat(lo, hi)),
    float(`${p}.res`, `${name} resonance`, d.res, pct),
    float(`${p}.drive`, `${name} analog drive`, d.drive, pct),
    choice(`${p}.slope`, `${name} slope`, SLOPES, SLOPES.indexOf(d.slope)),
  ];
};

export const PARAMS: readonly ParamSpec[] = [
  ...slotSpecs(1),
  ...slotSpecs(2),
  ...slotSpecs(3),
  ...slotSpecs(4),
  float('eq.character', 'EQ character', EQ_DEFAULTS.character, pct),
  float('eq.tilt', 'EQ tilt', EQ_DEFAULTS.tilt, pct),
  float('eq.sweetSpot', 'Sweet spot', EQ_DEFAULTS.sweetSpot, pct),
  ...filterSpecs('hpf'),
  ...filterSpecs('lpf'),
  bool('route.preEq', 'Pre EQ', true),
  bool('route.postFilters', 'Post filters', true),
  bool('route.parallel', 'Parallel mix', true),
  choice('route.stereo', 'Stereo mode', STEREO_MODES, 0),
];

export const SPEC: Record<ParamId, ParamSpec> = Object.fromEntries(
  PARAMS.map((p) => [p.id, p]),
) as Record<ParamId, ParamSpec>;

export const PARAM_IDS: readonly ParamId[] = PARAMS.map((p) => p.id);

export function defaultValues(): Values {
  return Object.fromEntries(PARAMS.map((p) => [p.id, p.default])) as Values;
}
