/** Clamp to the normalized 0..1 range. Non-finite input becomes 0. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
