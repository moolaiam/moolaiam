import { describe, expect, it } from 'vitest';
import { METER_FLOOR_DB, createMeterState, dbToPos, linToDb, stepMeter, type MeterState } from '../src/meters/ballistics';

function run(linear: number, seconds: number, fps: number, start: MeterState = createMeterState()): MeterState {
  const dt = 1 / fps;
  let s = start;
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i++) s = stepMeter(s, linear, dt);
  return s;
}

describe('dB mapping', () => {
  it('maps amplitude to dBFS and floors silence', () => {
    expect(linToDb(1)).toBeCloseTo(0, 6);
    expect(linToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(linToDb(0)).toBe(METER_FLOOR_DB);
    expect(linToDb(-1)).toBe(METER_FLOOR_DB);
  });

  it('maps dB to a logarithmic bar position', () => {
    expect(dbToPos(0)).toBe(1);
    expect(dbToPos(-60)).toBe(0);
    expect(dbToPos(-30)).toBeCloseTo(0.5, 6);
    // Half amplitude is about -6 dB, which sits near the top of the bar, not at the middle.
    expect(dbToPos(linToDb(0.5))).toBeGreaterThan(0.85);
  });
});

describe('meter ballistics', () => {
  it('rises fast and falls slowly', () => {
    const up = run(1, 0.05, 60);
    expect(up.level).toBeGreaterThan(-1);

    const down = run(0, 0.3, 60, up);
    expect(down.level).toBeLessThan(-5);
    expect(down.level).toBeGreaterThan(-30);
  });

  it('gives the same result at 60 Hz and 120 Hz for the same elapsed time', () => {
    const at60 = run(0.5, 1, 60);
    const at120 = run(0.5, 1, 120);
    expect(at60.level).toBeCloseTo(at120.level, 6);
    expect(at60.hold).toBeCloseTo(at120.hold, 3);
  });

  it('holds the peak, then falls back to the level', () => {
    const peak = run(1, 0.05, 60);
    expect(peak.hold).toBeCloseTo(peak.level, 0);

    const afterHold = run(0, 0.2, 60, peak); // still inside the hold window
    expect(afterHold.hold).toBeGreaterThan(-1);

    const later = run(0, 4, 60, peak); // well past the hold window
    expect(later.hold).toBeLessThan(-20);
    expect(later.hold).toBeGreaterThanOrEqual(later.level);
  });

  it('decays to the floor on silence', () => {
    const s = run(0, 8, 60, run(1, 0.05, 60));
    expect(s.level).toBeLessThan(-55);
  });
});
