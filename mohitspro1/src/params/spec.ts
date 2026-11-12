export const NEURAL_TYPES = ["Tube", "Transformer", "Tape", "Console", "Solid State"] as const;
export const FILTER_SLOPES = ["6dB", "12dB", "24dB", "48dB"] as const;
export const CHANNEL_MODES = ["L/R", "M/S"] as const;
export const QUALITY_MODES = ["1x", "2x", "4x"] as const;

export type ParamKind = "continuous" | "toggle" | "choice";

export interface ParamDef {
  readonly id: ParamId;
  readonly label: string;
  readonly defaultValue: number; // Always normalized 0..1
  readonly kind: ParamKind;
  readonly choices?: readonly string[];
  readonly format: (normalized: number) => string;
}

export const PARAM_IDS = [
  "master.inputGain",
  "master.outputGain",
  "master.mix",
  "master.bypass",
  "master.levelMatch",
  "master.quality",
  "slot1.enabled",
  "slot1.gain",
  "slot1.drive",
  "slot1.x2",
  "slot1.harmonicExp",
  "slot1.type",
  "slot2.enabled",
  "slot2.gain",
  "slot2.drive",
  "slot2.x2",
  "slot2.harmonicExp",
  "slot2.type",
  "slot3.enabled",
  "slot3.gain",
  "slot3.drive",
  "slot3.x2",
  "slot3.harmonicExp",
  "slot3.type",
  "slot4.enabled",
  "slot4.gain",
  "slot4.drive",
  "slot4.x2",
  "slot4.harmonicExp",
  "slot4.type",
  "eq.character",
  "eq.tilt",
  "eq.sweetSpot",
  "hpf.freq",
  "hpf.resonance",
  "hpf.drive",
  "hpf.slope",
  "lpf.freq",
  "lpf.resonance",
  "lpf.drive",
  "lpf.slope",
  "routing.preEq",
  "routing.postFilters",
  "routing.channelMode",
] as const;

export type ParamId = (typeof PARAM_IDS)[number];
export type ParamMap = Record<ParamId, number>;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function choiceToNormalized(index: number, count: number): number {
  if (count <= 1) return 0;
  return clamp01(index / (count - 1));
}

export function normalizedToChoiceIndex(normalized: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(clamp01(normalized) * (count - 1));
}

const formatDbBipolar = (v: number): string => {
  const db = (clamp01(v) - 0.5) * 24;
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
};

const formatPercent = (v: number): string => `${Math.round(clamp01(v) * 100)}%`;

const formatToggle = (v: number): string => (clamp01(v) >= 0.5 ? "ON" : "OFF");

const formatLogHz = (minHz: number, maxHz: number) => (v: number): string => {
  const hz = Math.round(minHz * Math.pow(maxHz / minHz, clamp01(v)));
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz} Hz`;
};

const formatChoice = (choices: readonly string[]) => (v: number): string =>
  choices[normalizedToChoiceIndex(v, choices.length)] ?? choices[0];

const makeSlotDefs = (slotNum: 1 | 2 | 3 | 4, defaults: { gain: number; drive: number; x2: number; harmonicExp: number; typeIdx: number }): ParamDef[] => [
  { id: `slot${slotNum}.enabled` as ParamId, label: `Slot ${slotNum} Enabled`, defaultValue: 1, kind: "toggle", format: formatToggle },
  { id: `slot${slotNum}.gain` as ParamId, label: `Slot ${slotNum} Gain`, defaultValue: defaults.gain, kind: "continuous", format: formatDbBipolar },
  { id: `slot${slotNum}.drive` as ParamId, label: `Slot ${slotNum} Drive`, defaultValue: defaults.drive, kind: "continuous", format: formatPercent },
  { id: `slot${slotNum}.x2` as ParamId, label: `Slot ${slotNum} X2`, defaultValue: defaults.x2, kind: "toggle", format: formatToggle },
  { id: `slot${slotNum}.harmonicExp` as ParamId, label: `Slot ${slotNum} Harmonic Exp`, defaultValue: defaults.harmonicExp, kind: "continuous", format: formatPercent },
  {
    id: `slot${slotNum}.type` as ParamId,
    label: `Slot ${slotNum} Type`,
    defaultValue: choiceToNormalized(defaults.typeIdx, NEURAL_TYPES.length),
    kind: "choice",
    choices: NEURAL_TYPES,
    format: formatChoice(NEURAL_TYPES),
  },
];

const ALL_PARAM_DEFS: readonly ParamDef[] = [
  { id: "master.inputGain", label: "Input Trim", defaultValue: 0.5, kind: "continuous", format: formatDbBipolar },
  { id: "master.outputGain", label: "Output Trim", defaultValue: 0.5, kind: "continuous", format: formatDbBipolar },
  { id: "master.mix", label: "Dry / Wet Mix", defaultValue: 1, kind: "continuous", format: formatPercent },
  { id: "master.bypass", label: "Bypass", defaultValue: 0, kind: "toggle", format: formatToggle },
  { id: "master.levelMatch", label: "Level Match", defaultValue: 1, kind: "toggle", format: formatToggle },
  { id: "master.quality", label: "Quality (Oversampling)", defaultValue: choiceToNormalized(1, QUALITY_MODES.length), kind: "choice", choices: QUALITY_MODES, format: formatChoice(QUALITY_MODES) },
  ...makeSlotDefs(1, { gain: 0.52, drive: 0.35, x2: 0, harmonicExp: 0.45, typeIdx: 0 }),
  ...makeSlotDefs(2, { gain: 0.48, drive: 0.42, x2: 1, harmonicExp: 0.55, typeIdx: 1 }),
  ...makeSlotDefs(3, { gain: 0.55, drive: 0.30, x2: 0, harmonicExp: 0.40, typeIdx: 2 }),
  ...makeSlotDefs(4, { gain: 0.50, drive: 0.50, x2: 0, harmonicExp: 0.60, typeIdx: 3 }),
  { id: "eq.character", label: "One Knob EQ Character", defaultValue: 0.50, kind: "continuous", format: formatPercent },
  { id: "eq.tilt", label: "One Knob EQ Low/Mix", defaultValue: 0.50, kind: "continuous", format: formatPercent },
  { id: "eq.sweetSpot", label: "Sweet Spot", defaultValue: 0.65, kind: "continuous", format: formatPercent },
  { id: "hpf.freq", label: "HPF Frequency", defaultValue: 0.18, kind: "continuous", format: formatLogHz(20, 1200) },
  { id: "hpf.resonance", label: "HPF Resonance", defaultValue: 0.25, kind: "continuous", format: formatPercent },
  { id: "hpf.drive", label: "HPF Drive", defaultValue: 0.20, kind: "continuous", format: formatPercent },
  { id: "hpf.slope", label: "HPF Slope", defaultValue: choiceToNormalized(2, FILTER_SLOPES.length), kind: "choice", choices: FILTER_SLOPES, format: formatChoice(FILTER_SLOPES) },
  { id: "lpf.freq", label: "LPF Frequency", defaultValue: 0.82, kind: "continuous", format: formatLogHz(1500, 20000) },
  { id: "lpf.resonance", label: "LPF Resonance", defaultValue: 0.25, kind: "continuous", format: formatPercent },
  { id: "lpf.drive", label: "LPF Drive", defaultValue: 0.20, kind: "continuous", format: formatPercent },
  { id: "lpf.slope", label: "LPF Slope", defaultValue: choiceToNormalized(2, FILTER_SLOPES.length), kind: "choice", choices: FILTER_SLOPES, format: formatChoice(FILTER_SLOPES) },
  { id: "routing.preEq", label: "Pre EQ", defaultValue: 1, kind: "toggle", format: formatToggle },
  { id: "routing.postFilters", label: "Post Filters", defaultValue: 1, kind: "toggle", format: formatToggle },
  { id: "routing.channelMode", label: "Channel Mode", defaultValue: 0, kind: "choice", choices: CHANNEL_MODES, format: formatChoice(CHANNEL_MODES) },
];

export const PARAM_SPEC: Record<ParamId, ParamDef> = Object.fromEntries(
  ALL_PARAM_DEFS.map((def) => [def.id, def])
) as Record<ParamId, ParamDef>;

export const DEFAULT_PARAMS: ParamMap = Object.fromEntries(
  ALL_PARAM_DEFS.map((def) => [def.id, clamp01(def.defaultValue)])
) as ParamMap;

export const PRESET_OVERRIDES = {
  "Advanced Genesis Library Browser": {},
  "Clean Transparent": {
    "slot1.gain": 0.50,
    "slot1.drive": 0.12,
    "slot1.x2": 0,
    "slot1.harmonicExp": 0.20,
    "slot1.type": choiceToNormalized(4, NEURAL_TYPES.length),
    "slot2.gain": 0.50,
    "slot2.drive": 0.10,
    "slot2.x2": 0,
    "slot2.harmonicExp": 0.15,
    "slot2.type": choiceToNormalized(3, NEURAL_TYPES.length),
    "eq.character": 0.50,
    "eq.tilt": 0.50,
    "eq.sweetSpot": 0.35,
    "hpf.freq": 0.10,
    "hpf.resonance": 0.15,
    "hpf.drive": 0.10,
    "hpf.slope": choiceToNormalized(1, FILTER_SLOPES.length),
    "lpf.freq": 0.92,
    "lpf.resonance": 0.15,
    "lpf.drive": 0.10,
    "lpf.slope": choiceToNormalized(1, FILTER_SLOPES.length),
  },
  "Vintage Warmth": {
    "slot1.gain": 0.60,
    "slot1.drive": 0.65,
    "slot1.x2": 1,
    "slot1.harmonicExp": 0.70,
    "slot1.type": choiceToNormalized(0, NEURAL_TYPES.length),
    "slot2.gain": 0.55,
    "slot2.drive": 0.58,
    "slot2.x2": 0,
    "slot2.harmonicExp": 0.62,
    "slot2.type": choiceToNormalized(2, NEURAL_TYPES.length),
    "eq.character": 0.22,
    "eq.tilt": 0.38,
    "eq.sweetSpot": 0.78,
    "hpf.freq": 0.15,
    "hpf.resonance": 0.30,
    "hpf.drive": 0.45,
    "hpf.slope": choiceToNormalized(1, FILTER_SLOPES.length),
    "lpf.freq": 0.74,
    "lpf.resonance": 0.35,
    "lpf.drive": 0.40,
    "lpf.slope": choiceToNormalized(2, FILTER_SLOPES.length),
  },
  "Digital Edge": {
    "slot1.gain": 0.58,
    "slot1.drive": 0.72,
    "slot1.x2": 1,
    "slot1.harmonicExp": 0.80,
    "slot1.type": choiceToNormalized(4, NEURAL_TYPES.length),
    "slot3.gain": 0.62,
    "slot3.drive": 0.64,
    "slot3.x2": 1,
    "slot3.harmonicExp": 0.75,
    "slot3.type": choiceToNormalized(1, NEURAL_TYPES.length),
    "eq.character": 0.76,
    "eq.tilt": 0.68,
    "eq.sweetSpot": 0.84,
    "hpf.freq": 0.24,
    "hpf.resonance": 0.45,
    "hpf.drive": 0.35,
    "hpf.slope": choiceToNormalized(3, FILTER_SLOPES.length),
    "lpf.freq": 0.88,
    "lpf.resonance": 0.40,
    "lpf.drive": 0.30,
    "lpf.slope": choiceToNormalized(2, FILTER_SLOPES.length),
  },
} as const satisfies Record<string, Partial<ParamMap>>;

export type PresetName = keyof typeof PRESET_OVERRIDES;

export function resolvePreset(name: PresetName): ParamMap {
  const overrides = PRESET_OVERRIDES[name];
  const out = { ...DEFAULT_PARAMS };
  for (const [k, v] of Object.entries(overrides)) {
    out[k as ParamId] = clamp01(v as number);
  }
  return out;
}
