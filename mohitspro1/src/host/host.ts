import { PARAM_IDS, SPEC, type ParamId } from '../params/spec';
import { clamp01 } from '../util';

/** Linear peak amplitudes from the host. 1.0 = 0 dBFS. */
export interface MeterFrame {
  inL: number;
  inR: number;
  outL: number;
  outR: number;
}

/**
 * Raw connection to a host. Values are normalized 0..1.
 * `read` returns undefined when the host has no parameter for that ID.
 */
export interface Transport {
  readonly name: string;
  read(id: ParamId): number | undefined;
  write(id: ParamId, value: number): void;
  beginGesture(id: ParamId): void;
  endGesture(id: ParamId): void;
  /** Host-driven changes (automation, preset recall). Returns an unsubscribe function. */
  onExternalChange(listener: (id: ParamId, value: number) => void): () => void;
  readMeters(): MeterFrame | null;
}

export type Scheduler = (fn: () => void) => unknown;

export interface Host {
  readonly transportName: string;
  get(id: ParamId): number;
  /** Queued. Writes for the same ID coalesce, and everything is flushed once per frame. */
  set(id: ParamId, value: number): void;
  beginGesture(id: ParamId): void;
  endGesture(id: ParamId): void;
  subscribe(listener: (id: ParamId, value: number) => void): () => void;
  meters(): MeterFrame | null;
  /** Writes out everything queued. Gestures call this first, so ordering is kept. */
  flush(): void;
}

const defaultScheduler: Scheduler = (fn) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 0);

export function createHost(transport: Transport, schedule: Scheduler = defaultScheduler): Host {
  const pending = new Map<ParamId, number>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    for (const [id, value] of pending) transport.write(id, value);
    pending.clear();
  };

  const queueFlush = (): void => {
    if (scheduled) return;
    scheduled = true;
    schedule(flush);
  };

  return {
    transportName: transport.name,

    get(id) {
      const queued = pending.get(id);
      if (queued !== undefined) return queued;
      const raw = transport.read(id);
      return raw === undefined || !Number.isFinite(raw) ? SPEC[id].default : clamp01(raw);
    },

    set(id, value) {
      pending.set(id, clamp01(value));
      queueFlush();
    },

    beginGesture(id) {
      flush();
      transport.beginGesture(id);
    },

    endGesture(id) {
      flush();
      transport.endGesture(id);
    },

    subscribe(listener) {
      return transport.onExternalChange((id, value) => {
        listener(id, Number.isFinite(value) ? clamp01(value) : SPEC[id].default);
      });
    },

    meters() {
      return transport.readMeters();
    },

    flush,
  };
}

/** Reads every parameter once. Used to initialize UI state from the host. */
export function readAll(host: Host): Record<ParamId, number> {
  return Object.fromEntries(PARAM_IDS.map((id) => [id, host.get(id)])) as Record<ParamId, number>;
}
