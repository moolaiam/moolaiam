import { describe, expect, it } from "vitest";
import { HostWriteQueue, type HostAdapter } from "../src/host/bridge.ts";
import { DEFAULT_PARAMS, resolvePreset } from "../src/params/spec.ts";
import { PluginController } from "../src/state/store.ts";

function setupController() {
  const events: string[] = [];
  const adapter: HostAdapter = {
    getAllParams: () => ({}),
    subscribeParams: () => () => {},
    subscribeMeters: () => () => {},
    beginGesture: (id) => events.push(`begin:${id}`),
    setParam: (id, v) => events.push(`set:${id}:${v.toFixed(3)}`),
    endGesture: (id) => events.push(`end:${id}`),
  };
  const queue = new HostWriteQueue(adapter, (cb) => {
    cb();
    return 1;
  }, () => {});
  const controller = new PluginController(queue);
  return { controller, events };
}

describe("PluginController A/B, Presets, Reset & Host Sync", () => {
  it("22. initializes on slot A with DEFAULT_PARAMS", () => {
    const { controller } = setupController();
    expect(controller.getState().activeSlot).toBe("A");
    expect(controller.getActiveParams()).toEqual(DEFAULT_PARAMS);
  });

  it("23. applies host-driven patches without echoing writes back to the host", () => {
    const { controller, events } = setupController();
    controller.applyHostPatch({ "eq.sweetSpot": 0.91 });
    expect(controller.getActiveParams()["eq.sweetSpot"]).toBeCloseTo(0.91, 6);
    expect(events).toEqual([]);
  });

  it("24. sends only changed parameters wrapped in gestures when selecting a preset", () => {
    const { controller, events } = setupController();
    controller.selectPreset("Clean Transparent");
    const clean = resolvePreset("Clean Transparent");
    expect(controller.getActiveParams()).toEqual(clean);

    // slot3 and slot4 are unchanged in Clean Transparent, so they must not be sent
    const sentSlot3 = events.some((e) => e.includes("slot3."));
    const sentSlot1Gain = events.some((e) => e.includes("set:slot1.gain:0.500"));
    expect(sentSlot3).toBe(false);
    expect(sentSlot1Gain).toBe(true);
  });

  it("25. sends only changed parameters wrapped in gestures on resetToDefaults", () => {
    const { controller, events } = setupController();
    controller.setParamDiscrete("eq.sweetSpot", 0.12);
    events.length = 0;

    controller.resetToDefaults();
    expect(controller.getActiveParams()["eq.sweetSpot"]).toBe(DEFAULT_PARAMS["eq.sweetSpot"]);
    expect(events).toEqual([
      "begin:eq.sweetSpot",
      `set:eq.sweetSpot:${DEFAULT_PARAMS["eq.sweetSpot"].toFixed(3)}`,
      "end:eq.sweetSpot",
    ]);
  });

  it("26. preserves independent A and B edits across A/B switches", () => {
    const { controller } = setupController();
    controller.setParamDiscrete("slot1.gain", 0.88);
    controller.switchAB(); // now on B (still at default 0.52)
    expect(controller.getState().activeSlot).toBe("B");
    expect(controller.getActiveParams()["slot1.gain"]).toBe(DEFAULT_PARAMS["slot1.gain"]);

    controller.setParamDiscrete("slot1.gain", 0.21);
    controller.switchAB(); // back to A
    expect(controller.getActiveParams()["slot1.gain"]).toBeCloseTo(0.88, 6);

    controller.switchAB(); // back to B -> B edit survived!
    expect(controller.getActiveParams()["slot1.gain"]).toBeCloseTo(0.21, 6);
  });

  it("27. sends only parameters that differ between A and B when switching A/B", () => {
    const { controller, events } = setupController();
    controller.switchAB(); // B
    controller.setParamDiscrete("eq.tilt", 0.95);
    events.length = 0;

    controller.switchAB(); // B -> A (only eq.tilt differs)
    expect(events).toEqual([
      "begin:eq.tilt",
      `set:eq.tilt:${DEFAULT_PARAMS["eq.tilt"].toFixed(3)}`,
      "end:eq.tilt",
    ]);
  });
});
