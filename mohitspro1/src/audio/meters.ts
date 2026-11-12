export const DB_MIN = -50;
export const DB_MAX = 0;
export const DB_SCALE_TICKS = [0, -5, -10, -15, -20, -25, -30, -35, -40, -45, -50] as const;

export interface MeterBallisticsConfig {
  readonly attackTauSec: number;
  readonly releaseTauSec: number;
  readonly holdDurationSec: number;
  readonly holdDecayDbPerSec: number;
}

export const DEFAULT_METER_CONFIG: MeterBallisticsConfig = {
  attackTauSec: 0.015,
  releaseTauSec: 0.300,
  holdDurationSec: 1.5,
  holdDecayDbPerSec: 18,
};

export interface ChannelBallisticsState {
  levelDb: number;
  peakHoldDb: number;
  holdRemainingSec: number;
}

export function createChannelBallisticsState(): ChannelBallisticsState {
  return {
    levelDb: DB_MIN,
    peakHoldDb: DB_MIN,
    holdRemainingSec: 0,
  };
}

export function clampDb(db: number): number {
  if (!Number.isFinite(db)) return DB_MIN;
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}

export function dbToNormalized(db: number): number {
  return (clampDb(db) - DB_MIN) / (DB_MAX - DB_MIN);
}

export function linearToDb(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 1e-5) return DB_MIN;
  return clampDb(20 * Math.log10(amplitude));
}

/**
 * Exact frame-rate-independent exponential ballistics + time-based peak hold.
 * Stepping N times at dt = T/N with constant targetDb yields the exact same
 * levelDb and peakHoldDb at 60 Hz, 120 Hz, or any variable refresh rate.
 */
export function stepChannelBallistics(
  state: ChannelBallisticsState,
  targetDbInput: number,
  dtSec: number,
  config: MeterBallisticsConfig = DEFAULT_METER_CONFIG
): ChannelBallisticsState {
  const dt = Math.max(0, dtSec);
  const targetDb = clampDb(targetDbInput);
  if (dt === 0) return state;

  const tau = targetDb > state.levelDb ? config.attackTauSec : config.releaseTauSec;
  const decayFactor = tau > 0 ? Math.exp(-dt / tau) : 0;
  const nextLevelDb = clampDb(targetDb + (state.levelDb - targetDb) * decayFactor);

  let nextHoldDb = state.peakHoldDb;
  let nextHoldRemaining = state.holdRemainingSec;

  if (nextLevelDb >= nextHoldDb) {
    nextHoldDb = nextLevelDb;
    nextHoldRemaining = config.holdDurationSec;
  } else if (nextHoldRemaining > 0) {
    const consume = Math.min(dt, nextHoldRemaining);
    nextHoldRemaining -= consume;
    const leftover = dt - consume;
    if (leftover > 0) {
      nextHoldDb = Math.max(nextLevelDb, nextHoldDb - config.holdDecayDbPerSec * leftover);
    }
  } else {
    nextHoldDb = Math.max(nextLevelDb, nextHoldDb - config.holdDecayDbPerSec * dt);
  }

  return {
    levelDb: nextLevelDb,
    peakHoldDb: clampDb(nextHoldDb),
    holdRemainingSec: nextHoldRemaining,
  };
}
