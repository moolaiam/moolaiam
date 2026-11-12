import { defaultValues, type ParamId } from '../params/spec';
import type { MeterFrame, Transport } from './host';

/**
 * In-memory transport for the browser preview and for tests.
 * It has no audio, so meters report null (the UI shows NO SIGNAL).
 */
export interface MemoryTransport extends Transport {
  /** Log of everything the UI sent, in order. Useful in tests. */
  readonly log: Array<
    | { kind: 'write'; id: ParamId; value: number }
    | { kind: 'begin' | 'end'; id: ParamId }
  >;
  /** Simulate an automation or preset change coming from the host. */
  emitExternal(id: ParamId, value: number): void;
}

export function createMemoryTransport(initial: Partial<Record<ParamId, number>> = {}): MemoryTransport {
  const store = new Map<ParamId, number>(Object.entries({ ...defaultValues(), ...initial }) as [ParamId, number][]);
  const listeners = new Set<(id: ParamId, value: number) => void>();
  const log: MemoryTransport['log'] = [];

  return {
    name: 'preview',
    log,
    read: (id) => store.get(id),
    write(id, value) {
      store.set(id, value);
      log.push({ kind: 'write', id, value });
    },
    beginGesture: (id) => log.push({ kind: 'begin', id }),
    endGesture: (id) => log.push({ kind: 'end', id }),
    onExternalChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitExternal(id, value) {
      store.set(id, value);
      for (const l of listeners) l(id, value);
    },
    readMeters: (): MeterFrame | null => null,
  };
}
