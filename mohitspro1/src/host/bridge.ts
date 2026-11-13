import { clamp01, PARAM_IDS, type ParamId, type ParamMap } from "../params/spec.ts";

export interface MeterSide {
  readonly dbfsDb: number; // -50..0 dBFS
  readonly vuDb: number;   // -50..0 dBFS
}

export interface MeterFrame {
  readonly left: MeterSide;
  readonly right: MeterSide;
}

export interface HostAdapter {
  getAllParams(): Promise<Partial<ParamMap>> | Partial<ParamMap>;
  subscribeParams(listener: (patch: Partial<ParamMap>) => void): () => void;
  subscribeMeters(listener: (frame: MeterFrame | null) => void): () => void;
  beginGesture(id: ParamId): void;
  setParam(id: ParamId, value: number): void;
  endGesture(id: ParamId): void;
}

export type FrameScheduler = (cb: () => void) => number;
export type FrameCanceler = (handle: number) => void;

export class HostWriteQueue {
  private readonly host: HostAdapter;
  private readonly scheduleFrame: FrameScheduler;
  private readonly cancelFrame: FrameCanceler;
  private pending = new Map<ParamId, number>();
  private activeGestures = new Set<ParamId>();
  private rafId: number | null = null;

  constructor(
    host: HostAdapter,
    scheduleFrame: FrameScheduler = (cb) => requestAnimationFrame(cb),
    cancelFrame: FrameCanceler = (id) => cancelAnimationFrame(id)
  ) {
    this.host = host;
    this.scheduleFrame = scheduleFrame;
    this.cancelFrame = cancelFrame;
  }

  beginGesture(id: ParamId): void {
    if (this.activeGestures.has(id)) return;
    this.activeGestures.add(id);
    this.host.beginGesture(id);
  }

  queueWrite(id: ParamId, value: number): void {
    this.pending.set(id, clamp01(value));
    if (this.rafId === null) {
      this.rafId = this.scheduleFrame(() => {
        this.rafId = null;
        this.flush();
      });
    }
  }

  flush(): void {
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId);
      this.rafId = null;
    }
    if (this.pending.size === 0) return;
    const entries = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [id, value] of entries) {
      this.host.setParam(id, value);
    }
  }

  endGesture(id: ParamId): void {
    if (this.pending.has(id)) {
      const value = this.pending.get(id)!;
      this.pending.delete(id);
      this.host.setParam(id, value);
    }
    if (this.activeGestures.delete(id)) {
      this.host.endGesture(id);
    }
  }

  /**
   * Sends a discrete single-parameter change wrapped in begin/set/end gesture.
   */
  writeDiscrete(id: ParamId, value: number): void {
    this.pending.delete(id);
    const clamped = clamp01(value);
    const alreadyOpen = this.activeGestures.has(id);
    if (!alreadyOpen) this.host.beginGesture(id);
    this.host.setParam(id, clamped);
    if (!alreadyOpen) this.host.endGesture(id);
  }

  /**
   * Sends a multi-parameter batch (presets, A/B switch, reset) where every
   * changed parameter is wrapped in beginGesture -> setParam -> endGesture.
   */
  writeBatch(changes: Partial<ParamMap>): void {
    const entries = Object.entries(changes) as [ParamId, number][];
    if (entries.length === 0) return;
    for (const [id, value] of entries) {
      this.writeDiscrete(id, value);
    }
  }

  dispose(): void {
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.pending.clear();
    for (const id of Array.from(this.activeGestures)) {
      this.host.endGesture(id);
    }
    this.activeGestures.clear();
  }
}

/** A JUCE WebSliderRelay as seen from the page. Values are normalized 0..1. */
export interface JuceSliderState {
  getNormalisedValue(): number;
  setNormalisedValue(v: number): void;
  sliderDragStarted(): void;
  sliderDragEnded(): void;
  valueChangedEvent: { addListener(fn: () => void): void };
}

declare global {
  interface Window {
    __JUCE__?: {
      getSliderState?: (id: string) => JuceSliderState | undefined;
      backend?: {
        addEventListener: (event: string, cb: (payload: unknown) => void) => void;
        removeEventListener?: (event: string, cb: (payload: unknown) => void) => void;
        emitEvent: (event: string, payload: unknown) => void;
      };
    };
    __MOHITS_HOST__?: Partial<HostAdapter>;
  }
}

/**
 * Host adapter for the JUCE WebView. Every parameter is a WebSliderRelay created by the
 * C++ editor, so gestures, automation and undo work like any native control.
 */
export function createJuceRelayAdapter(juce: NonNullable<Window["__JUCE__"]>): HostAdapter {
  const states = new Map<ParamId, JuceSliderState | undefined>();
  const stateOf = (id: ParamId): JuceSliderState | undefined => {
    if (!states.has(id)) {
      try {
        states.set(id, juce.getSliderState?.(id));
      } catch {
        states.set(id, undefined);
      }
    }
    return states.get(id);
  };

  return {
    getAllParams() {
      const out: Partial<ParamMap> = {};
      for (const id of PARAM_IDS) {
        const s = stateOf(id);
        if (s) out[id] = s.getNormalisedValue();
      }
      return out;
    },
    subscribeParams(listener) {
      let active = true;
      for (const id of PARAM_IDS) {
        const s = stateOf(id);
        if (!s) continue;
        s.valueChangedEvent.addListener(() => {
          if (active) listener({ [id]: s.getNormalisedValue() } as Partial<ParamMap>);
        });
      }
      return () => {
        active = false;
      };
    },
    subscribeMeters(listener) {
      // Meters come from the C++ side in step 10. Until then the UI shows NO SIGNAL.
      listener(null);
      return () => {};
    },
    beginGesture(id) {
      stateOf(id)?.sliderDragStarted();
    },
    setParam(id, value) {
      stateOf(id)?.setNormalisedValue(value);
    },
    endGesture(id) {
      stateOf(id)?.sliderDragEnded();
    },
  };
}

/** How many parameter relays the JUCE page can see, out of the total. 0 means none. */
export function countJuceRelays(): number {
  const juce = typeof window !== "undefined" ? window.__JUCE__ : undefined;
  if (!juce?.getSliderState) return 0;
  return PARAM_IDS.filter((id) => {
    try {
      return juce.getSliderState?.(id) !== undefined;
    } catch {
      return false;
    }
  }).length;
}

export function createBrowserHostAdapter(): HostAdapter {
  if (typeof window !== "undefined" && window.__JUCE__?.getSliderState) {
    return createJuceRelayAdapter(window.__JUCE__);
  }

  const paramListeners = new Set<(patch: Partial<ParamMap>) => void>();
  const meterListeners = new Set<(frame: MeterFrame | null) => void>();

  return {
    async getAllParams() {
      if (typeof window !== "undefined" && window.__MOHITS_HOST__?.getAllParams) {
        return await window.__MOHITS_HOST__.getAllParams();
      }
      return {};
    },
    subscribeParams(listener) {
      paramListeners.add(listener);
      const customUnsub =
        typeof window !== "undefined" && window.__MOHITS_HOST__?.subscribeParams
          ? window.__MOHITS_HOST__.subscribeParams(listener)
          : undefined;

      const juce = typeof window !== "undefined" ? window.__JUCE__?.backend : undefined;
      const juceHandler = (payload: unknown) => {
        if (payload && typeof payload === "object") {
          const p = payload as { id?: ParamId; value?: number; params?: Partial<ParamMap> };
          if (p.params) listener(p.params);
          else if (p.id && typeof p.value === "number") listener({ [p.id]: p.value });
        }
      };
      juce?.addEventListener("paramChange", juceHandler);

      return () => {
        paramListeners.delete(listener);
        customUnsub?.();
        juce?.removeEventListener?.("paramChange", juceHandler);
      };
    },
    subscribeMeters(listener) {
      meterListeners.add(listener);
      const customUnsub =
        typeof window !== "undefined" && window.__MOHITS_HOST__?.subscribeMeters
          ? window.__MOHITS_HOST__.subscribeMeters(listener)
          : undefined;

      if (!customUnsub) {
        // No host meter stream attached -> explicitly report NO SIGNAL (null)
        listener(null);
      }

      return () => {
        meterListeners.delete(listener);
        customUnsub?.();
      };
    },
    beginGesture(id) {
      if (typeof window !== "undefined") {
        window.__MOHITS_HOST__?.beginGesture?.(id);
        window.__JUCE__?.backend?.emitEvent("beginGesture", { id });
      }
    },
    setParam(id, value) {
      if (typeof window !== "undefined") {
        window.__MOHITS_HOST__?.setParam?.(id, value);
        window.__JUCE__?.backend?.emitEvent("paramChange", { id, value });
      }
    },
    endGesture(id) {
      if (typeof window !== "undefined") {
        window.__MOHITS_HOST__?.endGesture?.(id);
        window.__JUCE__?.backend?.emitEvent("endGesture", { id });
      }
    },
  };
}
