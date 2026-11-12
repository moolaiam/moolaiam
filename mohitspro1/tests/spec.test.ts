import { describe, expect, it } from 'vitest';
import { PARAMS, PARAM_IDS, SPEC, choiceIndex, choiceValue, defaultValues, SLOT_TYPES, SLOPES } from '../src/params/spec';
import { PRESETS, presetValues } from '../src/params/presets';

describe('parameter spec', () => {
  it('has unique IDs and the expected count', () => {
    expect(new Set(PARAM_IDS).size).toBe(PARAM_IDS.length);
    // 4 slots x 5 + 3 EQ + 2 filters x 4 + 4 routing
    expect(PARAMS.length).toBe(35);
  });

  it('keeps every default inside 0..1', () => {
    for (const p of PARAMS) {
      expect(p.default).toBeGreaterThanOrEqual(0);
      expect(p.default).toBeLessThanOrEqual(1);
    }
  });

  it('formats gain as dB around 0.5, with no "-0.0"', () => {
    expect(SPEC['slot1.gain'].format(0.5)).toBe('0.0 dB');
    expect(SPEC['slot1.gain'].format(1)).toBe('+12.0 dB');
    expect(SPEC['slot1.gain'].format(0)).toBe('-12.0 dB');
    expect(SPEC['slot1.gain'].format(0.5001)).toBe('0.0 dB');
  });

  it('maps the HPF and LPF sweeps log-scale over their own ranges', () => {
    expect(SPEC['hpf.freq'].format(0)).toBe('20 Hz');
    expect(SPEC['hpf.freq'].format(1)).toBe('1.20 kHz');
    expect(SPEC['lpf.freq'].format(0)).toBe('1.50 kHz');
    expect(SPEC['lpf.freq'].format(1)).toBe('20.00 kHz');
  });

  it('round-trips choice indices through normalized values', () => {
    for (let i = 0; i < SLOT_TYPES.length; i++) {
      expect(choiceIndex(SLOT_TYPES.length, choiceValue(SLOT_TYPES.length, i))).toBe(i);
    }
    expect(SPEC['hpf.slope'].format(choiceValue(SLOPES.length, 3))).toBe('48dB');
    expect(SPEC['slot3.type'].format(SPEC['slot3.type'].default)).toBe('Tape');
  });

  it('clamps out-of-range choice values instead of indexing past the list', () => {
    expect(choiceIndex(4, 2)).toBe(3);
    expect(choiceIndex(4, -1)).toBe(0);
  });

  it('builds a full default snapshot', () => {
    const v = defaultValues();
    expect(Object.keys(v).sort()).toEqual([...PARAM_IDS].sort());
  });
});

describe('presets', () => {
  it('gives every preset a complete, in-range snapshot', () => {
    for (const p of PRESETS) {
      expect(Object.keys(p.values).length).toBe(PARAM_IDS.length);
      for (const id of PARAM_IDS) {
        const v = p.values[id];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('Init equals the defaults', () => {
    expect(presetValues('init')).toEqual(defaultValues());
  });

  it('Vintage Warmth sets the slot type by name', () => {
    expect(SPEC['slot1.type'].format(presetValues('vintage')['slot1.type'])).toBe('Tube');
    expect(SPEC['slot2.type'].format(presetValues('vintage')['slot2.type'])).toBe('Tape');
  });
});
