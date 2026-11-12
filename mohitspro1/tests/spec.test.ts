import { describe, expect, it } from "vitest";
import {
  choiceToNormalized,
  clamp01,
  DEFAULT_PARAMS,
  FILTER_SLOPES,
  NEURAL_TYPES,
  normalizedToChoiceIndex,
  PARAM_IDS,
  PARAM_SPEC,
  PRESET_OVERRIDES,
  resolvePreset,
  type PresetName,
} from "../src/params/spec.ts";

describe("PARAM_SPEC & Presets", () => {
  it("1. defines every PARAM_ID with normalized 0..1 defaultValue", () => {
    for (const id of PARAM_IDS) {
      const def = PARAM_SPEC[id];
      expect(def).toBeDefined();
      expect(def.defaultValue).toBeGreaterThanOrEqual(0);
      expect(def.defaultValue).toBeLessThanOrEqual(1);
    }
  });

  it("2. builds DEFAULT_PARAMS covering all PARAM_IDS in 0..1", () => {
    expect(Object.keys(DEFAULT_PARAMS).length).toBe(PARAM_IDS.length);
    for (const id of PARAM_IDS) {
      expect(DEFAULT_PARAMS[id]).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_PARAMS[id]).toBeLessThanOrEqual(1);
    }
  });

  it("3. formats every parameter cleanly at 0, 0.5, and 1", () => {
    for (const id of PARAM_IDS) {
      const def = PARAM_SPEC[id];
      for (const v of [0, 0.5, 1]) {
        const text = def.format(v);
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("4. round-trips discrete choice indices via normalized 0..1", () => {
    NEURAL_TYPES.forEach((_, idx) => {
      const norm = choiceToNormalized(idx, NEURAL_TYPES.length);
      expect(normalizedToChoiceIndex(norm, NEURAL_TYPES.length)).toBe(idx);
    });
    FILTER_SLOPES.forEach((_, idx) => {
      const norm = choiceToNormalized(idx, FILTER_SLOPES.length);
      expect(normalizedToChoiceIndex(norm, FILTER_SLOPES.length)).toBe(idx);
    });
  });

  it("5. clamps non-finite and out-of-range values safely", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("6. resolves every preset to a complete normalized 0..1 ParamMap", () => {
    for (const name of Object.keys(PRESET_OVERRIDES) as PresetName[]) {
      const map = resolvePreset(name);
      expect(Object.keys(map).length).toBe(PARAM_IDS.length);
      for (const id of PARAM_IDS) {
        expect(map[id]).toBeGreaterThanOrEqual(0);
        expect(map[id]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("7. applies distinct overrides for non-default presets", () => {
    const clean = resolvePreset("Clean Transparent");
    const vintage = resolvePreset("Vintage Warmth");
    const edge = resolvePreset("Digital Edge");
    expect(clean["eq.sweetSpot"]).not.toBe(vintage["eq.sweetSpot"]);
    expect(vintage["eq.character"]).not.toBe(edge["eq.character"]);
  });
});
