import type { Values } from '../params/spec';

export type Slot = 'A' | 'B';

/**
 * Two independent snapshots. The active slot is live, so its stored copy is stale
 * until the user switches away, and switching writes the live state back first.
 */
export interface ABState {
  active: Slot;
  slots: Record<Slot, Values>;
}

export function createAB(initial: Values): ABState {
  return { active: 'A', slots: { A: initial, B: initial } };
}

/**
 * Stores the live values into the active slot, then activates the other slot.
 * Returns the values to load into the UI and the host.
 */
export function switchAB(state: ABState, live: Values): { state: ABState; next: Values } {
  const to: Slot = state.active === 'A' ? 'B' : 'A';
  const slots: Record<Slot, Values> = { ...state.slots, [state.active]: live };
  return { state: { active: to, slots }, next: slots[to] };
}
