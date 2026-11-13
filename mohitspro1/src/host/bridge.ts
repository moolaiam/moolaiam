import { clamp01, PARAM_IDS, type ParamId, type ParamMap } from "../params/spec.ts";
import { getSliderState, type JuceSliderState } from "../juce/juce-frontend.js";

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

declare global {
  interface Window {
    __JUCE__?: {
      initialisationData?: { __juce__sliders?: string[] };
      backend?: {
        addEventListener: (event: string, cb: (payload: unknown) => void) => void;
        removeEventListener?: (event: string, cb: (payload: unknown) => void) => void;
        emitEvent: (event: string, payload: unknown) => void;
      };
    };
    __MOHITS_HOST__?: Partial<HostAdapter>;
  }
}

/** True inside the JUCE WebView. */
export function isJuceHost(): boolean {
  return typeof window !== "undefined" && window.__JUCE__ !== undefined;
}

/** The parameter IDs the plugin has registered a relay for. */
function registeredRelayIds(): Set<string> {
  return new Set(window.__JUCE__?.initialisationData?.__juce__sliders ?? []);
}

/** How many parameter relays the plugin registered, out of the total. */
export function countJuceRelays(): number {
  if (!isJuceHost()) return 0;
  const registered = registeredRelayIds();
  return PARAM_IDS.filter((id) => registered.has(id)).length;
}

/** Checks a meter message from the plugin. Anything malformed is dropped. */
function toMeterFrame(payload: unknown): MeterFrame | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const side = (value: unknown): MeterSide | null => {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.dbfsDb !== "number" || typeof v.vuDb !== "number") return null;
    if (!Number.isFinite(v.dbfsDb) || !Number.isFinite(v.vuDb)) return null;
    return { dbfsDb: v.dbfsDb, vuDb: v.vuDb };
  };
  const left = side(p.left);
  const right = side(p.right);
  return left && right ? { left, right } : null;
}

/** A meter message older than this counts as "no signal". */
const METER_STALE_MS = 500;

/**
 * Host adapter for the JUCE WebView. Every parameter is a WebSliderRelay created by the
 * C++ editor, so gestures, automation and undo work like any native control.
 */
export function createJuceRelayAdapter(): HostAdapter {
  const registered = registeredRelayIds();
  const states = new Map<ParamId, JuceSliderState>();
  const stateOf = (id: ParamId): JuceSliderState | undefined => {
    if (!registered.has(id)) return undefined;
    if (!states.has(id)) states.set(id, getSliderState(id));
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
      let active = true;
      let lastFrameAt = 0;

      window.__JUCE__?.backend?.addEventListener("meters", (payload: unknown) => {
        if (!active) return;
        const frame = toMeterFrame(payload);
        if (frame) {
          lastFrameAt = Date.now();
          listener(frame);
        }
      });

      // No meter message for a while means the plugin isn't sending audio levels.
      const staleTimer = window.setInterval(() => {
        if (active && Date.now() - lastFrameAt > METER_STALE_MS) listener(null);
      }, 250);

      listener(null);
      return () => {
        active = false;
        window.clearInterval(staleTimer);
      };
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

export function createBrowserHostAdapter(): HostAdapter {
  if (isJuceHost()) {
    return createJuceRelayAdapter();
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
