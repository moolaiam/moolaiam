import { PARAM_IDS, type ParamId, type Values } from '../params/spec';

/** IDs whose values differ between two snapshots. */
export function diffValues(from: Values, to: Values): ParamId[] {
  return PARAM_IDS.filter((id) => Math.abs(from[id] - to[id]) > 1e-9);
}

export function valuesEqual(a: Values, b: Values): boolean {
  return diffValues(a, b).length === 0;
}
