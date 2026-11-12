import { describe, expect, it } from "vitest";
import { HostWriteQueue, type HostAdapter } from "../src/host/bridge.ts";
import type { ParamId } from "../src/params/spec.ts";

function createMockHost() {
  const events: string[] = [];
  const adapter: HostAdapter = {
    getAllParams: () => ({}),
    subscribeParams: () => () => {},
    subscribeMeters: () => () => {},
    beginGesture: (id) => events.push(`begin:${id}`),
    setParam: (id, v) => events.push(`set:${id}:${v.toFixed(3)}`),
    endGesture: (id) => events.push(`end:${id}`),
  };
  return { adapter, events };
}

function createManualRaf() {
  let nextId = 1;
  const cbs = new Map<number, () => void>();
  const schedule = (cb: () => void) => {
    const id = nextId++;
    cbs.set(id, cb);
    return id;
  };
  const cancel = (id: number) => {
    cbs.delete(id);
  };
  const flushFrame = () => {
    const list = Array.from(cbs.values());
    cbs.clear();
    list.forEach((cb) => cb());
  };
  return { schedule, cancel, flushFrame, pendingCount: () => cbs.size };
}

describe("HostWriteQueue Coalescing & Gesture Ordering", () => {
  it("15. coalesces multiple writes to the same param within one frame", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.queueWrite("slot1.gain", 0.1);
    queue.queueWrite("slot1.gain", 0.4);
    queue.queueWrite("slot1.gain", 0.85);
    expect(raf.pendingCount()).toBe(1);
    expect(events).toEqual([]);

    raf.flushFrame();
    expect(events).toEqual(["set:slot1.gain:0.850"]);
  });

  it("16. flushes distinct params in one frame in a single RAF pass", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.queueWrite("slot1.gain", 0.25);
    queue.queueWrite("eq.sweetSpot", 0.75);
    expect(raf.pendingCount()).toBe(1);

    raf.flushFrame();
    expect(events).toEqual(["set:slot1.gain:0.250", "set:eq.sweetSpot:0.750"]);
  });

  it("17. flushes pending queued write before endGesture", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.beginGesture("eq.tilt");
    queue.queueWrite("eq.tilt", 0.9);
    queue.endGesture("eq.tilt");

    expect(events).toEqual([
      "begin:eq.tilt",
      "set:eq.tilt:0.900",
      "end:eq.tilt",
    ]);
  });

  it("18. keeps beginGesture idempotent while gesture is active", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.beginGesture("hpf.freq");
    queue.beginGesture("hpf.freq");
    queue.endGesture("hpf.freq");

    expect(events).toEqual(["begin:hpf.freq", "end:hpf.freq"]);
  });

  it("19. wraps discrete writes in begin -> set -> end gesture order", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.writeDiscrete("lpf.slope", 1);
    expect(events).toEqual(["begin:lpf.slope", "set:lpf.slope:1.000", "end:lpf.slope"]);
  });

  it("20. wraps batch writes (presets/A-B/reset) in per-param gestures", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    const batch: Partial<Record<ParamId, number>> = {
      "slot1.drive": 0.65,
      "eq.sweetSpot": 0.78,
    };
    queue.writeBatch(batch);

    expect(events).toEqual([
      "begin:slot1.drive",
      "set:slot1.drive:0.650",
      "end:slot1.drive",
      "begin:eq.sweetSpot",
      "set:eq.sweetSpot:0.780",
      "end:eq.sweetSpot",
    ]);
  });

  it("21. cancels scheduled RAF and closes open gestures on dispose", () => {
    const { adapter, events } = createMockHost();
    const raf = createManualRaf();
    const queue = new HostWriteQueue(adapter, raf.schedule, raf.cancel);

    queue.beginGesture("slot2.gain");
    queue.queueWrite("slot2.gain", 0.3);
    queue.dispose();

    expect(raf.pendingCount()).toBe(0);
    expect(events).toEqual(["begin:slot2.gain", "end:slot2.gain"]);
  });
});
