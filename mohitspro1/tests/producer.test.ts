import { describe, expect, it } from "vitest";
import { HostWriteQueue, type HostAdapter } from "../src/host/bridge.ts";
import {
  PluginController,
  parsePresetFile,
  sanitizeParams,
  serializePreset,
  type PresetStorage,
} from "../src/state/store.ts";
import { DEFAULT_PARAMS, PARAM_IDS, type ParamId } from "../src/params/spec.ts";

function fakeHost() {
  const log: string[] = [];
  const host: HostAdapter = {
    getAllParams: () => ({}),
    subscribeParams: () => () => {},
    subscribeMeters: () => () => {},
    beginGesture: (id) => log.push(`begin:${id}`),
    setParam: (id, v) => log.push(`set:${id}=${v}`),
    endGesture: (id) => log.push(`end:${id}`),
  };
  return { host, log };
}

function memoryStorage(initial: string | null = null): PresetStorage & { text: string | null } {
  const s = {
    text: initial,
    read() {
      return s.text;
    },
    write(text: string) {
      s.text = text;
    },
  };
  return s;
}

function setup(storageText: string | null = null) {
  const { host, log } = fakeHost();
  const frames: Array<() => void> = [];
  const queue = new HostWriteQueue(
    host,
    (cb) => {
      frames.push(cb);
      return frames.length;
    },
    () => {},
  );
  const storage = memoryStorage(storageText);
  const controller = new PluginController(queue, undefined, storage);
  const runFrames = () => frames.splice(0).forEach((f) => f());
  return { controller, log, storage, runFrames };
}

describe("master section defaults", () => {
  it("starts with trims at 0 dB, full wet mix, bypass off, level match on, 2x quality", () => {
    const { controller } = setup();
    const p = controller.getActiveParams();
    expect(p["master.inputGain"]).toBe(0.5);
    expect(p["master.outputGain"]).toBe(0.5);
    expect(p["master.mix"]).toBe(1);
    expect(p["master.bypass"]).toBe(0);
    expect(p["master.levelMatch"]).toBe(1);
    expect(p["master.quality"]).toBeCloseTo(1 / 2);
  });

  it("replaces the old parallel toggle with a continuous mix and has per-slot enables", () => {
    expect(PARAM_IDS).not.toContain("routing.parallelWetDry");
    for (const n of [1, 2, 3, 4]) {
      expect(PARAM_IDS).toContain(`slot${n}.enabled`);
      expect(DEFAULT_PARAMS[`slot${n}.enabled` as ParamId]).toBe(1);
    }
  });
});

describe("undo and redo", () => {
  it("undoes and redoes a discrete change", () => {
    const { controller } = setup();
    controller.setParamDiscrete("master.bypass", 1);
    expect(controller.getState().canUndo).toBe(true);

    controller.undo();
    expect(controller.getActiveParams()["master.bypass"]).toBe(0);
    expect(controller.getState().canRedo).toBe(true);

    controller.redo();
    expect(controller.getActiveParams()["master.bypass"]).toBe(1);
  });

  it("treats one drag gesture as one undo step", () => {
    const { controller, runFrames } = setup();
    const before = controller.getActiveParams()["eq.tilt"];
    controller.beginEdit("eq.tilt");
    controller.setParamContinuous("eq.tilt", 0.6);
    controller.setParamContinuous("eq.tilt", 0.7);
    controller.setParamContinuous("eq.tilt", 0.9);
    controller.endEdit("eq.tilt");
    runFrames();

    controller.undo();
    expect(controller.getActiveParams()["eq.tilt"]).toBe(before);
    expect(controller.getState().canUndo).toBe(false);
  });

  it("does not create an undo step for a gesture that changed nothing", () => {
    const { controller } = setup();
    controller.beginEdit("eq.tilt");
    controller.endEdit("eq.tilt");
    expect(controller.getState().canUndo).toBe(false);
  });

  it("clears redo history when a new edit is made", () => {
    const { controller } = setup();
    controller.setParamDiscrete("master.bypass", 1);
    controller.undo();
    expect(controller.getState().canRedo).toBe(true);

    controller.setParamDiscrete("master.levelMatch", 0);
    expect(controller.getState().canRedo).toBe(false);
  });

  it("undoes a preset load back to the previous values", () => {
    const { controller } = setup();
    const before = { ...controller.getActiveParams() };
    controller.selectPreset("Vintage Warmth");
    expect(controller.getActiveParams()["slot1.drive"]).not.toBe(before["slot1.drive"]);

    controller.undo();
    expect(controller.getActiveParams()["slot1.drive"]).toBe(before["slot1.drive"]);
  });
});

describe("copy, revert and A/B", () => {
  it("copies the active slot into the other slot without sending anything to the host", () => {
    const { controller, log } = setup();
    controller.setParamDiscrete("slot2.drive", 0.9);
    const writesBefore = log.length;

    controller.copyActiveToOther();
    expect(controller.getState().snapshots.B["slot2.drive"]).toBe(0.9);
    expect(log.length).toBe(writesBefore);
  });

  it("revert reloads the selected preset, but does nothing once the preset is modified", () => {
    const { controller } = setup();
    controller.selectPreset("Clean Transparent");
    const clean = { ...controller.getActiveParams() };

    controller.setParamDiscrete("slot1.gain", 0.9);
    expect(controller.getState().presetName).toBe("Custom");
    controller.revertToPreset();
    expect(controller.getActiveParams()["slot1.gain"]).toBe(0.9);

    controller.selectPreset("Clean Transparent");
    controller.setParamDiscrete("slot1.gain", 0.9);
    controller.revertToPreset(); // Custom: no-op
    controller.selectPreset("Clean Transparent");
    expect(controller.getActiveParams()).toEqual(clean);
  });
});

describe("user presets: save, delete, export and import", () => {
  it("saves the active slot under a name, persists it, and reloads it later", () => {
    const { controller, storage } = setup();
    controller.setParamDiscrete("eq.tilt", 0.11);
    expect(controller.saveUserPreset("  My Warm Mix  ")).toBeNull();
    expect(controller.getState().presetName).toBe("My Warm Mix");
    expect(controller.getState().userPresetNames).toEqual(["My Warm Mix"]);
    expect(storage.text).toContain("My Warm Mix");

    const reloaded = setup(storage.text);
    expect(reloaded.controller.getState().userPresetNames).toEqual(["My Warm Mix"]);
    reloaded.controller.selectPreset("My Warm Mix");
    expect(reloaded.controller.getActiveParams()["eq.tilt"]).toBeCloseTo(0.11);
  });

  it("rejects empty names and names that belong to built-in presets", () => {
    const { controller } = setup();
    expect(controller.saveUserPreset("   ")).toMatch(/Enter a name/);
    expect(controller.saveUserPreset("Vintage Warmth")).toMatch(/built-in/);
    expect(controller.getState().userPresetNames).toEqual([]);
  });

  it("deletes a user preset and persists the removal", () => {
    const { controller, storage } = setup();
    controller.saveUserPreset("Temp");
    controller.deleteUserPreset("Temp");
    expect(controller.getState().userPresetNames).toEqual([]);
    expect(JSON.parse(storage.text ?? "{}")).toEqual({});
  });

  it("round-trips a preset through the exported file format", () => {
    const { controller } = setup();
    controller.setParamDiscrete("hpf.freq", 0.42);
    const text = controller.exportActivePreset();
    const parsed = parsePresetFile(text);
    expect(parsed.params["hpf.freq"]).toBeCloseTo(0.42);
    expect(parsed.name).toBe("Custom preset"); // edited, so no longer the built-in name
  });

  it("imports a valid file, applies it, and keeps it as a user preset", () => {
    const { controller } = setup();
    const source = serializePreset("Imported Test", { ...DEFAULT_PARAMS, "eq.sweetSpot": 0.2 });
    expect(controller.importPreset(source)).toBe("Imported Test");
    expect(controller.getActiveParams()["eq.sweetSpot"]).toBeCloseTo(0.2);
    expect(controller.getState().userPresetNames).toContain("Imported Test");
  });

  it("explains why a bad file was rejected", () => {
    const { controller } = setup();
    expect(() => controller.importPreset("not json")).toThrow(/not valid JSON/);
    expect(() => controller.importPreset(JSON.stringify({ format: "other" }))).toThrow(/not a MOHITS PRO 1 preset/);
    expect(() => controller.importPreset(JSON.stringify({ format: "mohits-pro-1-preset", version: 1 }))).toThrow(
      /no parameters/,
    );
  });

  it("renames an imported preset whose name collides with a built-in", () => {
    const { controller } = setup();
    const source = serializePreset("Clean Transparent", DEFAULT_PARAMS);
    expect(controller.importPreset(source)).toBe("Clean Transparent (imported)");
  });

  it("ignores corrupt stored presets and still starts", () => {
    const { controller } = setup("{not json");
    expect(controller.getState().userPresetNames).toEqual([]);
  });
});

describe("sanitizeParams", () => {
  it("keeps only known IDs, clamps values, and fills gaps with defaults", () => {
    const out = sanitizeParams({ "eq.tilt": 3, "not.a.param": 0.5, "master.mix": -2 });
    expect(out).not.toBeNull();
    expect(out!["eq.tilt"]).toBe(1);
    expect(out!["master.mix"]).toBe(0);
    expect(out!["slot1.gain"]).toBe(DEFAULT_PARAMS["slot1.gain"]);
    expect(Object.keys(out!)).not.toContain("not.a.param");
  });

  it("returns null for non-objects", () => {
    expect(sanitizeParams(null)).toBeNull();
    expect(sanitizeParams("x")).toBeNull();
  });
});
