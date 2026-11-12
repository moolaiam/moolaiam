import {
  SLOPES,
  SLOT_TYPES,
  choiceValue,
  defaultValues,
  type FilterPrefix,
  type FilterSettings,
  type Slope,
  type SlotNumber,
  type SlotSettings,
  type SlotType,
  type Values,
} from './spec';

export type PresetId = 'init' | 'clean' | 'vintage' | 'digital';

export interface Preset {
  id: PresetId;
  name: string;
  values: Values;
}

// Choice params are stored as normalized steps, so presets convert names to steps here.
const typeStep = (t: SlotType): number => choiceValue(SLOT_TYPES.length, SLOT_TYPES.indexOf(t));
const slopeStep = (s: Slope): number => choiceValue(SLOPES.length, SLOPES.indexOf(s));

function slotPatch(n: SlotNumber, s: SlotSettings): Partial<Values> {
  return {
    [`slot${n}.gain`]: s.gain,
    [`slot${n}.drive`]: s.drive,
    [`slot${n}.harmonic`]: s.harmonic,
    [`slot${n}.x2`]: s.x2 ? 1 : 0,
    [`slot${n}.type`]: typeStep(s.type),
  } as Partial<Values>;
}

function filterPatch(p: FilterPrefix, f: FilterSettings): Partial<Values> {
  return {
    [`${p}.freq`]: f.freq,
    [`${p}.res`]: f.res,
    [`${p}.drive`]: f.drive,
    [`${p}.slope`]: slopeStep(f.slope),
  } as Partial<Values>;
}

const PATCHES: Record<PresetId, { name: string; patch: Partial<Values> }> = {
  init: { name: 'Init', patch: {} },

  clean: {
    name: 'Clean Transparent',
    patch: {
      ...slotPatch(1, { gain: 0.5, drive: 0.12, x2: false, harmonic: 0.2, type: 'Solid State' }),
      ...slotPatch(2, { gain: 0.5, drive: 0.1, x2: false, harmonic: 0.15, type: 'Console' }),
      'eq.character': 0.5,
      'eq.tilt': 0.5,
      'eq.sweetSpot': 0.35,
      ...filterPatch('hpf', { freq: 0.1, res: 0.15, drive: 0.1, slope: '12dB' }),
      ...filterPatch('lpf', { freq: 0.92, res: 0.15, drive: 0.1, slope: '12dB' }),
    },
  },

  vintage: {
    name: 'Vintage Warmth',
    patch: {
      ...slotPatch(1, { gain: 0.6, drive: 0.65, x2: true, harmonic: 0.7, type: 'Tube' }),
      ...slotPatch(2, { gain: 0.55, drive: 0.58, x2: false, harmonic: 0.62, type: 'Tape' }),
      'eq.character': 0.22,
      'eq.tilt': 0.38,
      'eq.sweetSpot': 0.78,
      ...filterPatch('hpf', { freq: 0.15, res: 0.3, drive: 0.45, slope: '12dB' }),
      ...filterPatch('lpf', { freq: 0.74, res: 0.35, drive: 0.4, slope: '24dB' }),
    },
  },

  digital: {
    name: 'Digital Edge',
    patch: {
      ...slotPatch(1, { gain: 0.58, drive: 0.72, x2: true, harmonic: 0.8, type: 'Solid State' }),
      ...slotPatch(3, { gain: 0.62, drive: 0.64, x2: true, harmonic: 0.75, type: 'Transformer' }),
      'eq.character': 0.76,
      'eq.tilt': 0.68,
      'eq.sweetSpot': 0.84,
      ...filterPatch('hpf', { freq: 0.24, res: 0.45, drive: 0.35, slope: '48dB' }),
      ...filterPatch('lpf', { freq: 0.88, res: 0.4, drive: 0.3, slope: '24dB' }),
    },
  },
};

export const PRESETS: readonly Preset[] = (Object.keys(PATCHES) as PresetId[]).map((id) => ({
  id,
  name: PATCHES[id].name,
  values: { ...defaultValues(), ...PATCHES[id].patch } as Values,
}));

export function presetValues(id: PresetId): Values {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p.values;
}
