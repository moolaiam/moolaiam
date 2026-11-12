import { describe, expect, it } from 'vitest';
import { createHost, readAll } from '../src/host/host';
import { createMemoryTransport } from '../src/host/memory';
import { parseMeters } from '../src/host/juce';
import { PARAM_IDS, defaultValues, type ParamId } from '../src/params/spec';

// A scheduler we control, so the test decides when a frame happens.
function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      queue.push(fn);
    },
    runFrame: () => {
      const work = queue.splice(0);
      work.forEach((fn) => fn());
    },
  };
}

describe('host writes', () => {
  it('coalesces repeated writes to one transport write per ID per frame', () => {
    const t = createMemoryTransport();
    const s = manualScheduler();
    const host = createHost(t, s.schedule);

    host.set('slot1.gain', 0.1);
    host.set('slot1.gain', 0.2);
    host.set('slot1.gain', 0.3);
    expect(t.log.filter((e) => e.kind === 'write')).toHaveLength(0);

    s.runFrame();
    const writes = t.log.filter((e) => e.kind === 'write');
    expect(writes).toEqual([{ kind: 'write', id: 'slot1.gain', value: 0.3 }]);
  });

  it('returns the pending value from get() before the frame flushes', () => {
    const host = createHost(createMemoryTransport(), manualScheduler().schedule);
    host.set('eq.tilt', 0.9);
    expect(host.get('eq.tilt')).toBe(0.9);
  });

  it('flushes queued writes before a gesture ends, so the host sees them inside the gesture', () => {
    const t = createMemoryTransport();
    const s = manualScheduler();
    const host = createHost(t, s.schedule);

    host.beginGesture('hpf.freq');
    host.set('hpf.freq', 0.4);
    host.endGesture('hpf.freq');

    expect(t.log).toEqual([
      { kind: 'begin', id: 'hpf.freq' },
      { kind: 'write', id: 'hpf.freq', value: 0.4 },
      { kind: 'end', id: 'hpf.freq' },
    ]);
  });

  it('clamps values to 0..1 and treats NaN as the default', () => {
    const t = createMemoryTransport({ 'eq.tilt': Number.NaN });
    const host = createHost(t, manualScheduler().schedule);
    expect(host.get('eq.tilt')).toBe(defaultValues()['eq.tilt']);

    host.set('eq.tilt', 3);
    host.flush();
    expect(host.get('eq.tilt')).toBe(1);
  });
});

describe('host subscriptions', () => {
  it('forwards external changes without echoing them back as writes', () => {
    const t = createMemoryTransport();
    const host = createHost(t, manualScheduler().schedule);
    const seen: Array<[ParamId, number]> = [];
    const unsub = host.subscribe((id, v) => seen.push([id, v]));

    t.emitExternal('route.parallel', 0);
    expect(seen).toEqual([['route.parallel', 0]]);
    expect(t.log.filter((e) => e.kind === 'write')).toHaveLength(0);

    unsub();
    t.emitExternal('route.parallel', 1);
    expect(seen).toHaveLength(1);
  });

  it('hydrates every parameter from the host', () => {
    const t = createMemoryTransport({ 'slot2.x2': 0 });
    const all = readAll(createHost(t, manualScheduler().schedule));
    expect(Object.keys(all).sort()).toEqual([...PARAM_IDS].sort());
    expect(all['slot2.x2']).toBe(0);
  });
});

describe('meter payload validation', () => {
  it('accepts a complete frame and clamps it to 0..4', () => {
    expect(parseMeters({ inL: 0.5, inR: 0.25, outL: -1, outR: 9 })).toEqual({
      inL: 0.5,
      inR: 0.25,
      outL: 0,
      outR: 4,
    });
  });

  it('rejects missing, non-numeric or non-finite fields', () => {
    expect(parseMeters(undefined)).toBeNull();
    expect(parseMeters({ inL: 0.1, inR: 0.1, outL: 0.1 })).toBeNull();
    expect(parseMeters({ inL: 'x', inR: 0.1, outL: 0.1, outR: 0.1 })).toBeNull();
    expect(parseMeters({ inL: Number.NaN, inR: 0, outL: 0, outR: 0 })).toBeNull();
  });
});
