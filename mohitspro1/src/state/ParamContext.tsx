import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SPEC, type ParamId, type Values } from '../params/spec';
import type { Host } from '../host/host';
import { readAll } from '../host/host';
import { diffValues } from './values';

export interface Control {
  id: ParamId;
  label: string;
  value: number;
  defaultValue: number;
  format: (v: number) => string;
  /** Queued update. Called while dragging, so it is coalesced by the host. */
  set: (v: number) => void;
  /** Opens an undo/automation gesture. Pair with end(). */
  begin: () => void;
  end: () => void;
}

interface ParamContextValue {
  host: Host;
  values: Values;
  control: (id: ParamId) => Control;
  /** Loads a full snapshot and emits only the values that changed. */
  applyValues: (next: Values) => void;
}

const Ctx = createContext<ParamContextValue | null>(null);

export function ParamProvider({ host, children }: { host: Host; children: ReactNode }) {
  const [values, setValues] = useState<Values>(() => readAll(host) as Values);
  // Mirror of the latest values, so handlers never read stale state.
  const latest = useRef<Values>(values);

  const commit = useCallback((next: Values) => {
    latest.current = next;
    setValues(next);
  }, []);

  // Host-driven changes (automation, preset recall) update the UI without echoing back.
  useEffect(
    () =>
      host.subscribe((id, v) => {
        if (latest.current[id] === v) return;
        commit({ ...latest.current, [id]: v });
      }),
    [host, commit],
  );

  const set = useCallback(
    (id: ParamId, v: number) => {
      if (latest.current[id] === v) return;
      host.set(id, v);
      commit({ ...latest.current, [id]: v });
    },
    [host, commit],
  );

  const applyValues = useCallback(
    (next: Values) => {
      const ids = diffValues(latest.current, next);
      if (ids.length === 0) return;
      ids.forEach((id) => host.beginGesture(id));
      ids.forEach((id) => host.set(id, next[id]));
      ids.forEach((id) => host.endGesture(id));
      commit({ ...next });
    },
    [host, commit],
  );

  const control = useCallback(
    (id: ParamId): Control => {
      const spec = SPEC[id];
      return {
        id,
        label: spec.label,
        value: values[id],
        defaultValue: spec.default,
        format: spec.format,
        set: (v) => set(id, v),
        begin: () => host.beginGesture(id),
        end: () => host.endGesture(id),
      };
    },
    [host, values, set],
  );

  const ctx = useMemo<ParamContextValue>(
    () => ({ host, values, control, applyValues }),
    [host, values, control, applyValues],
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useParams(): ParamContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useParams must be used inside <ParamProvider>');
  return c;
}

/** A single discrete change (toggle, choice) wrapped in one gesture. */
export function tap(c: Control, v: number): void {
  c.begin();
  c.set(v);
  c.end();
}
