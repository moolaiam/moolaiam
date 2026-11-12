/**
 * Meter display ballistics. Time-based, so behavior does not depend on frame rate.
 * Level is in dBFS. Input is a linear peak amplitude (1.0 = 0 dBFS).
 */

export const METER_FLOOR_DB = -60;
export const METER_CEIL_DB = 0;

const ATTACK_S = 0.005; // rise time constant
const RELEASE_S = 0.6; // fall time constant
const HOLD_S = 1.5; // peak-hold duration
const HOLD_FALL_DB_PER_S = 12;

export interface MeterState {
  level: number;
  hold: number;
  holdTimer: number;
}

export function createMeterState(): MeterState {
  return { level: METER_FLOOR_DB, hold: METER_FLOOR_DB, holdTimer: 0 };
}

export function linToDb(linear: number): number {
  if (!(linear > 0)) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(linear));
}

/** Maps dB to a 0..1 bar position, so the scale is logarithmic, not linear. */
export function dbToPos(db: number): number {
  const p = (db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB);
  return Math.min(1, Math.max(0, p));
}

/**
 * Advances one meter by `dt` seconds. Exponential smoothing composes exactly,
 * so 60 Hz and 120 Hz produce the same result after the same elapsed time.
 */
export function stepMeter(s: MeterState, linear: number, dt: number): MeterState {
  const target = linToDb(linear);
  const tau = target > s.level ? ATTACK_S : RELEASE_S;
  const level = target + (s.level - target) * Math.exp(-dt / tau);

  let hold = s.hold;
  let holdTimer = s.holdTimer;
  if (level >= hold) {
    hold = level;
    holdTimer = HOLD_S;
  } else if (holdTimer > 0) {
    holdTimer = Math.max(0, holdTimer - dt);
  } else {
    hold = Math.max(level, hold - HOLD_FALL_DB_PER_S * dt);
  }
  return { level, hold, holdTimer };
}
