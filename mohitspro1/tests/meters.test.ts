import { describe, expect, it } from "vitest";
import {
  clampDb,
  createChannelBallisticsState,
  DB_MAX,
  DB_MIN,
  dbToNormalized,
  linearToDb,
  stepChannelBallistics,
} from "../src/audio/meters.ts";

function runSteps(hz: number, durationSec: number, targetDb: number, initial = createChannelBallisticsState()) {
  const steps = Math.round(hz * durationSec);
  const dt = 1 / hz;
  let state = initial;
  for (let i = 0; i < steps; i++) {
    state = stepChannelBallistics(state, targetDb, dt);
  }
  return state;
}

describe("Meters & Time-Based Ballistics", () => {
  it("8. maps linear amplitude and dB values onto -50..0 dBFS", () => {
    expect(linearToDb(0)).toBe(DB_MIN);
    expect(linearToDb(1)).toBe(DB_MAX);
    expect(dbToNormalized(DB_MIN)).toBe(0);
    expect(dbToNormalized(DB_MAX)).toBe(1);
    expect(dbToNormalized(-25)).toBeCloseTo(0.5, 6);
  });

  it("9. produces identical attack trajectories at 60 Hz and 120 Hz", () => {
    const s60 = runSteps(60, 0.1, -6);
    const s120 = runSteps(120, 0.1, -6);
    expect(s60.levelDb).toBeCloseTo(s120.levelDb, 8);
    expect(s60.peakHoldDb).toBeCloseTo(s120.peakHoldDb, 8);
  });

  it("10. produces identical release trajectories at 60 Hz and 120 Hz", () => {
    const hot = runSteps(60, 0.2, -3);
    const rel60 = runSteps(60, 0.5, -40, hot);
    const rel120 = runSteps(120, 0.5, -40, hot);
    expect(rel60.levelDb).toBeCloseTo(rel120.levelDb, 8);
  });

  it("11. pins peak hold identically during holdDurationSec at 60 Hz and 120 Hz", () => {
    const hot = runSteps(60, 0.2, -4);
    const hold60 = runSteps(60, 1.0, -50, hot);
    const hold120 = runSteps(120, 1.0, -50, hot);
    expect(hold60.peakHoldDb).toBeCloseTo(hot.peakHoldDb, 8);
    expect(hold120.peakHoldDb).toBeCloseTo(hot.peakHoldDb, 8);
  });

  it("12. decays peak hold at identical dB/s rate after hold expires at 60 Hz and 120 Hz", () => {
    const hot = runSteps(60, 0.2, -4);
    const after60 = runSteps(60, 2.0, -50, hot);
    const after120 = runSteps(120, 2.0, -50, hot);
    expect(after60.peakHoldDb).toBeLessThan(hot.peakHoldDb);
    expect(after60.peakHoldDb).toBeCloseTo(after120.peakHoldDb, 8);
  });

  it("13. treats dt = 0 as a pure no-op", () => {
    const s = createChannelBallisticsState();
    expect(stepChannelBallistics(s, -6, 0)).toEqual(s);
  });

  it("14. clamps NaN and out-of-range dB inputs safely", () => {
    expect(clampDb(Number.NaN)).toBe(DB_MIN);
    expect(clampDb(12)).toBe(DB_MAX);
    expect(clampDb(-120)).toBe(DB_MIN);
  });
});
