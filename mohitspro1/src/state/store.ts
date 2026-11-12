import {
  clamp01,
  DEFAULT_PARAMS,
  PARAM_IDS,
  PRESET_OVERRIDES,
  resolvePreset,
  type ParamId,
  type ParamMap,
  type PresetName,
} from "../params/spec.ts";
import { HostWriteQueue } from "../host/bridge.ts";

export type ABSlot = "A" | "B";

export const CUSTOM_PRESET = "Custom";
export const BASE_PRESET: PresetName = "Mo' Hits Signature";
export const PRESET_FILE_FORMAT = "mohits-pro-1-preset";
export const PRESET_FILE_VERSION = 1;
const HISTORY_LIMIT = 200;
const PRESET_NAME_MAX = 60;

export interface PluginState {
  activeSlot: ABSlot;
  snapshots: {
    A: ParamMap;
    B: ParamMap;
  };
  /** Built-in preset name, user preset name, or "Custom" once edited. */
  presetName: string;
  userPresetNames: string[];
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryEntry {
  slot: ABSlot;
  map: ParamMap;
}

/** Where user presets live. The browser preview uses localStorage. In the plugin, use the host state. */
export interface PresetStorage {
  read(): string | null;
  write(text: string): void;
}

export function createLocalPresetStorage(key = "mohits-pro-1.user-presets"): PresetStorage {
  let memory: string | null = null;
  return {
    read() {
      try {
        return globalThis.localStorage?.getItem(key) ?? memory;
      } catch {
        return memory;
      }
    },
    write(text) {
      memory = text;
      try {
        globalThis.localStorage?.setItem(key, text);
      } catch {
        // Storage blocked or full: the preset stays in memory for this session.
      }
    },
  };
}

export function createInitialPluginState(initialOverrides?: Partial<ParamMap>): PluginState {
  const base = { ...DEFAULT_PARAMS };
  if (initialOverrides) {
    for (const id of PARAM_IDS) {
      if (typeof initialOverrides[id] === "number") {
        base[id] = clamp01(initialOverrides[id]!);
      }
    }
  }
  return {
    activeSlot: "A",
    snapshots: {
      A: { ...base },
      B: { ...base },
    },
    presetName: BASE_PRESET,
    userPresetNames: [],
    canUndo: false,
    canRedo: false,
  };
}

export function diffParamMaps(current: ParamMap, next: ParamMap): Partial<ParamMap> {
  const changed: Partial<ParamMap> = {};
  for (const id of PARAM_IDS) {
    if (Math.abs(current[id] - next[id]) > 1e-6) {
      changed[id] = next[id];
    }
  }
  return changed;
}

/** Keeps only known IDs, clamps values, and fills gaps with defaults. Returns null if input isn't an object. */
export function sanitizeParams(input: unknown): ParamMap | null {
  if (typeof input !== "object" || input === null) return null;
  const src = input as Record<string, unknown>;
  const out: ParamMap = { ...DEFAULT_PARAMS };
  for (const id of PARAM_IDS) {
    const v = src[id];
    if (typeof v === "number") out[id] = clamp01(v);
  }
  return out;
}

export function serializePreset(name: string, params: ParamMap): string {
  return JSON.stringify({ format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, name, params }, null, 2);
}

export function parsePresetFile(text: string): { name: string; params: ParamMap } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (typeof data !== "object" || data === null) throw new Error("That file is not a preset.");
  const d = data as Record<string, unknown>;
  if (d.format !== PRESET_FILE_FORMAT) throw new Error("That file is not a MOHITS PRO 1 preset.");
  const params = sanitizeParams(d.params);
  if (!params) throw new Error("That preset has no parameters.");
  const name = typeof d.name === "string" && d.name.trim() ? d.name.trim().slice(0, PRESET_NAME_MAX) : "Imported preset";
  return { name, params };
}

function loadUserPresets(storage: PresetStorage): Record<string, ParamMap> {
  const out: Record<string, ParamMap> = {};
  try {
    const raw = storage.read();
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return out;
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      const params = sanitizeParams(value);
      if (params && !isBuiltinName(name)) out[name] = params;
    }
  } catch {
    // Corrupt storage is ignored, so the plugin still starts.
  }
  return out;
}

function isBuiltinName(name: string): boolean {
  return name === CUSTOM_PRESET || name in PRESET_OVERRIDES;
}

export class PluginController {
  private state: PluginState;
  private readonly writeQueue: HostWriteQueue;
  private readonly storage: PresetStorage;
  private userPresets: Record<string, ParamMap>;
  private undoStacks: Record<ABSlot, HistoryEntry[]> = { A: [], B: [] };
  private redoStacks: Record<ABSlot, HistoryEntry[]> = { A: [], B: [] };
  /** Snapshot taken when a gesture starts. It becomes an undo step only once the value actually changes. */
  private pendingUndo: HistoryEntry | null = null;
  private listeners = new Set<(state: PluginState) => void>();

  constructor(writeQueue: HostWriteQueue, initialOverrides?: Partial<ParamMap>, storage: PresetStorage = createLocalPresetStorage()) {
    this.writeQueue = writeQueue;
    this.storage = storage;
    this.userPresets = loadUserPresets(storage);
    this.state = this.decorate({ ...createInitialPluginState(initialOverrides) });
  }

  getState(): PluginState {
    return this.state;
  }

  getActiveParams(): ParamMap {
    return this.state.snapshots[this.state.activeSlot];
  }

  subscribe(listener: (state: PluginState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /** Recomputes derived fields (undo/redo availability, user preset list) and stores the new state. */
  private publish(patch: Partial<Pick<PluginState, "activeSlot" | "snapshots" | "presetName">>): void {
    this.state = this.decorate({ ...this.state, ...patch });
    this.emit();
  }

  private decorate(s: PluginState): PluginState {
    return {
      ...s,
      userPresetNames: Object.keys(this.userPresets),
      canUndo: this.undoStacks[s.activeSlot].length > 0,
      canRedo: this.redoStacks[s.activeSlot].length > 0,
    };
  }

  private pushUndo(entry: HistoryEntry): void {
    const stack = this.undoStacks[entry.slot];
    stack.push(entry);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    this.redoStacks[entry.slot] = [];
  }

  private commitPendingUndo(): void {
    if (this.pendingUndo) {
      this.pushUndo(this.pendingUndo);
      this.pendingUndo = null;
    }
  }

  private persistUserPresets(): void {
    this.storage.write(JSON.stringify(this.userPresets));
  }

  /**
   * Hydrates initial or host-driven parameter updates without echoing back to host.
   */
  applyHostPatch(patch: Partial<ParamMap>): void {
    const slot = this.state.activeSlot;
    const prev = this.state.snapshots[slot];
    let changed = false;
    const nextSnapshot = { ...prev };

    for (const [rawId, rawVal] of Object.entries(patch)) {
      const id = rawId as ParamId;
      if (id in nextSnapshot && typeof rawVal === "number") {
        const clamped = clamp01(rawVal);
        if (Math.abs(nextSnapshot[id] - clamped) > 1e-6) {
          nextSnapshot[id] = clamped;
          changed = true;
        }
      }
    }

    if (!changed) return;
    this.publish({ snapshots: { ...this.state.snapshots, [slot]: nextSnapshot } });
  }

  /** Gesture start (pointer down on a knob or slider). Remembers the state for undo. */
  beginEdit(id: ParamId): void {
    this.writeQueue.beginGesture(id);
    this.pendingUndo = { slot: this.state.activeSlot, map: { ...this.state.snapshots[this.state.activeSlot] } };
  }

  /** Gesture end. Flushes queued writes and closes the host gesture. */
  endEdit(id: ParamId): void {
    this.pendingUndo = null;
    this.writeQueue.endGesture(id);
  }

  /**
   * Continuous UI update (e.g. knob drag) -> updates active snapshot & queues coalesced write.
   */
  setParamContinuous(id: ParamId, value: number): void {
    const clamped = clamp01(value);
    const slot = this.state.activeSlot;
    const current = this.state.snapshots[slot];
    if (Math.abs(current[id] - clamped) <= 1e-6) return;

    this.commitPendingUndo();
    this.publish({
      presetName: CUSTOM_PRESET,
      snapshots: { ...this.state.snapshots, [slot]: { ...current, [id]: clamped } },
    });
    this.writeQueue.queueWrite(id, clamped);
  }

  /**
   * Discrete single-param update (keyboard, wheel, toggle, double-click reset).
   */
  setParamDiscrete(id: ParamId, value: number): void {
    const clamped = clamp01(value);
    const slot = this.state.activeSlot;
    const current = this.state.snapshots[slot];
    if (Math.abs(current[id] - clamped) <= 1e-6) return;

    this.pushUndo({ slot, map: { ...current } });
    this.publish({
      presetName: CUSTOM_PRESET,
      snapshots: { ...this.state.snapshots, [slot]: { ...current, [id]: clamped } },
    });
    this.writeQueue.writeDiscrete(id, clamped);
  }

  /**
   * Single unified path for presets, A/B switching, reset, undo and redo:
   * sends only the values that differ from the active snapshot, each in its own gesture.
   */
  private applySnapshot(targetMap: ParamMap, nextActiveSlot: ABSlot, nextPresetName: string, recordUndo: boolean): void {
    const activeSlot = this.state.activeSlot;
    const currentMap = this.state.snapshots[activeSlot];
    const changed = diffParamMaps(currentMap, targetMap);

    if (recordUndo && Object.keys(changed).length > 0) {
      this.pushUndo({ slot: activeSlot, map: { ...currentMap } });
    }

    this.writeQueue.writeBatch(changed);
    this.publish({
      activeSlot: nextActiveSlot,
      snapshots: { ...this.state.snapshots, [nextActiveSlot]: { ...targetMap } },
      presetName: nextPresetName,
    });
  }

  selectPreset(name: string): void {
    const map = name in PRESET_OVERRIDES ? resolvePreset(name as PresetName) : this.userPresets[name];
    if (!map) return;
    this.applySnapshot(map, this.state.activeSlot, name, true);
  }

  /** Reloads the selected preset, discarding edits. Does nothing for "Custom" or unknown names. */
  revertToPreset(): void {
    if (this.state.presetName === CUSTOM_PRESET) return;
    this.selectPreset(this.state.presetName);
  }

  resetToDefaults(): void {
    this.applySnapshot({ ...DEFAULT_PARAMS }, this.state.activeSlot, BASE_PRESET, true);
  }

  switchAB(): void {
    const targetSlot: ABSlot = this.state.activeSlot === "A" ? "B" : "A";
    const targetMap = this.state.snapshots[targetSlot];
    this.applySnapshot(targetMap, targetSlot, this.state.presetName, false);
  }

  /** Copies the active slot into the other slot, without changing what the host is playing. */
  copyActiveToOther(): void {
    const active = this.state.activeSlot;
    const other: ABSlot = active === "A" ? "B" : "A";
    this.publish({ snapshots: { ...this.state.snapshots, [other]: { ...this.state.snapshots[active] } } });
  }

  undo(): void {
    const slot = this.state.activeSlot;
    const entry = this.undoStacks[slot].pop();
    if (!entry) return;
    this.redoStacks[slot].push({ slot, map: { ...this.state.snapshots[slot] } });
    this.applySnapshot(entry.map, slot, CUSTOM_PRESET, false);
  }

  redo(): void {
    const slot = this.state.activeSlot;
    const entry = this.redoStacks[slot].pop();
    if (!entry) return;
    this.undoStacks[slot].push({ slot, map: { ...this.state.snapshots[slot] } });
    this.applySnapshot(entry.map, slot, CUSTOM_PRESET, false);
  }

  /** Saves the active slot as a named user preset. Returns an error message, or null on success. */
  saveUserPreset(rawName: string): string | null {
    const name = rawName.trim().slice(0, PRESET_NAME_MAX);
    if (!name) return "Enter a name for the preset.";
    if (isBuiltinName(name)) return "That name belongs to a built-in preset.";
    this.userPresets = { ...this.userPresets, [name]: { ...this.getActiveParams() } };
    this.persistUserPresets();
    this.publish({ presetName: name });
    return null;
  }

  deleteUserPreset(name: string): void {
    if (!(name in this.userPresets)) return;
    const { [name]: _removed, ...rest } = this.userPresets;
    this.userPresets = rest;
    this.persistUserPresets();
    this.publish({ presetName: this.state.presetName === name ? CUSTOM_PRESET : this.state.presetName });
  }

  /** JSON text of the active slot, ready to save as a file. */
  exportActivePreset(): string {
    const name = this.state.presetName === CUSTOM_PRESET ? "Custom preset" : this.state.presetName;
    return serializePreset(name, this.getActiveParams());
  }

  /** Loads a preset file into the active slot and keeps it as a user preset. Throws with a readable message on bad files. */
  importPreset(text: string): string {
    const parsed = parsePresetFile(text);
    let name = parsed.name;
    if (isBuiltinName(name)) name = `${name} (imported)`;
    this.userPresets = { ...this.userPresets, [name]: parsed.params };
    this.persistUserPresets();
    this.applySnapshot(parsed.params, this.state.activeSlot, name, true);
    return name;
  }
}
