import { describe, expect, it } from 'vitest';
import { createAB, switchAB } from '../src/state/ab';
import { diffValues, valuesEqual } from '../src/state/values';
import { defaultValues, type Values } from '../src/params/spec';

const withTilt = (v: Values, tilt: number): Values => ({ ...v, 'eq.tilt': tilt });

describe('A/B slots', () => {
  it('keeps edits made on B when switching back to A and then to B again', () => {
    const base = defaultValues();
    let ab = createAB(base);

    // On A, edit tilt to 0.2, then switch to B. A's edit is saved.
    let live = withTilt(base, 0.2);
    let r = switchAB(ab, live);
    ab = r.state;
    expect(r.next['eq.tilt']).toBe(base['eq.tilt']); // B starts as the original snapshot

    // On B, edit tilt to 0.8, then switch to A.
    live = withTilt(r.next, 0.8);
    r = switchAB(ab, live);
    ab = r.state;
    expect(r.next['eq.tilt']).toBe(0.2); // A comes back with its edit

    // Switch to B again: B's edit must still be there.
    r = switchAB(ab, r.next);
    expect(r.next['eq.tilt']).toBe(0.8);
  });

  it('reports the active slot correctly', () => {
    let ab = createAB(defaultValues());
    expect(ab.active).toBe('A');
    ab = switchAB(ab, defaultValues()).state;
    expect(ab.active).toBe('B');
  });
});

describe('value diffing', () => {
  it('returns only the IDs that changed', () => {
    const a = defaultValues();
    const b = withTilt(a, 0.9);
    expect(diffValues(a, b)).toEqual(['eq.tilt']);
    expect(valuesEqual(a, { ...a })).toBe(true);
    expect(valuesEqual(a, b)).toBe(false);
  });
});
