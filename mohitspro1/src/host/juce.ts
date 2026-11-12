import { PARAM_IDS, type ParamId } from '../params/spec';
import type { MeterFrame, Transport } from './host';

/**
 * JUCE WebView transport.
 *
 * Uses one WebSliderRelay per parameter ID (ID strings from params/spec.ts, range 0..1).
 * The relay API names follow JUCE's WebBrowserComponent relay JS interface. Confirm them
 * against the JUCE version you build with before shipping.
 */

interface JuceSliderRelay {
  getNormalisedValue(): number;
  setNormalisedValue(v: number): void;
  sliderDragStarted(): void;
  sliderDragEnded(): void;
  valueChangedEvent: { addListener(fn: () => void): void };
}

interface JuceGlobal {
  getSliderState?: (id: string) => JuceSliderRelay | undefined;
}

declare global {
  interface Window {
    __JUCE__?: JuceGlobal;
    /**
     * Written by the C++ side each frame (optional). Shape:
     * { inL, inR, outL, outR } as linear peak amplitudes, 1.0 = 0 dBFS.
     */
    __MOHITS_METERS__?: unknown;
  }
}

/** Validates a meter payload from the host. Anything malformed becomes null. */
export function parseMeters(raw: unknown): MeterFrame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const keys = ['inL', 'inR', 'outL', 'outR'] as const;
  const out: Partial<MeterFrame> = {};
  for (const k of keys) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = Math.min(4, Math.max(0, v));
  }
  return out as MeterFrame;
}

export function hasJuceBackend(): boolean {
  return typeof window !== 'undefined' && typeof window.__JUCE__?.getSliderState === 'function';
}

export function createJuceTransport(juce: JuceGlobal = window.__JUCE__ ?? {}): Transport {
  const relays = new Map<ParamId, JuceSliderRelay | undefined>();
  const relay = (id: ParamId): JuceSliderRelay | undefined => {
    if (!relays.has(id)) {
      try {
        relays.set(id, juce.getSliderState?.(id));
      } catch {
        relays.set(id, undefined);
      }
    }
    return relays.get(id);
  };

  return {
    name: 'juce',
    read: (id) => relay(id)?.getNormalisedValue(),
    write: (id, value) => relay(id)?.setNormalisedValue(value),
    beginGesture: (id) => relay(id)?.sliderDragStarted(),
    endGesture: (id) => relay(id)?.sliderDragEnded(),
    onExternalChange(listener) {
      const unsubs: Array<() => void> = [];
      for (const id of PARAM_IDS) {
        const r = relay(id);
        if (!r) continue;
        // JUCE relays have no per-listener removal, so a flag stops calls after unsubscribe.
        let active = true;
        r.valueChangedEvent.addListener(() => {
          if (active) listener(id, r.getNormalisedValue());
        });
        unsubs.push(() => {
          active = false;
        });
      }
      return () => unsubs.forEach((u) => u());
    },
    readMeters: () => parseMeters(typeof window !== 'undefined' ? window.__MOHITS_METERS__ : undefined),
  };
}
