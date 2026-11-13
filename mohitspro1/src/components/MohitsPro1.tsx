import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CHANNEL_MODES,
  FILTER_SLOPES,
  NEURAL_TYPES,
  PARAM_SPEC,
  PRESET_OVERRIDES,
  QUALITY_MODES,
  choiceToNormalized,
  normalizedToChoiceIndex,
  PARAM_IDS,
  type ParamId,
  type ParamMap,
} from "../params/spec.ts";
import { countJuceRelays, createBrowserHostAdapter, HostWriteQueue, type HostAdapter, type MeterFrame } from "../host/bridge.ts";
import { CUSTOM_PRESET, PluginController, type PluginState } from "../state/store.ts";
import { Knob } from "./Knob.tsx";
import { VUMeter } from "./VUMeter.tsx";

interface MohitsPro1Props {
  host?: HostAdapter;
}

/** Handlers shared by every control. Gestures go through the controller so undo sees them. */
interface ControlHandlers {
  onBeginGesture: (id: ParamId) => void;
  onDragChange: (id: ParamId, v: number) => void;
  onEndGesture: (id: ParamId) => void;
  onDiscreteChange: (id: ParamId, v: number) => void;
}

interface NeuralSlotCardProps extends ControlHandlers {
  slotNum: 1 | 2 | 3 | 4;
  params: ParamMap;
}

function NeuralSlotCard({ slotNum, params, ...handlers }: NeuralSlotCardProps) {
  const { onBeginGesture, onDragChange, onEndGesture, onDiscreteChange } = handlers;
  const enabledId = `slot${slotNum}.enabled` as ParamId;
  const gainId = `slot${slotNum}.gain` as ParamId;
  const driveId = `slot${slotNum}.drive` as ParamId;
  const x2Id = `slot${slotNum}.x2` as ParamId;
  const harmonicId = `slot${slotNum}.harmonicExp` as ParamId;
  const typeId = `slot${slotNum}.type` as ParamId;

  const enabled = params[enabledId] >= 0.5;
  const x2Active = params[x2Id] >= 0.5;
  const typeIdx = normalizedToChoiceIndex(params[typeId], NEURAL_TYPES.length);

  return (
    <section className={`mh-card mh-neural-slot ${enabled ? "" : "is-disabled"}`} aria-label={`Neural Emulation Slot ${slotNum}`}>
      <header className="mh-slot-header">
        <span className="mh-slot-badge">{slotNum}</span>
        <span className="mh-slot-title">Neural</span>
        <button
          type="button"
          className={`mh-pill-btn mh-slot-power ${enabled ? "is-active" : ""}`}
          aria-pressed={enabled}
          aria-label={`Slot ${slotNum} enabled`}
          onClick={() => onDiscreteChange(enabledId, enabled ? 0 : 1)}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </header>

      <div className="mh-slot-controls">
        <Knob
          paramId={gainId}
          value={params[gainId]}
          size={42}
          color="#38BDF8"
          label="Gain"
          onBeginGesture={onBeginGesture}
          onDragChange={onDragChange}
          onEndGesture={onEndGesture}
          onDiscreteChange={onDiscreteChange}
        />

        <div className="mh-slot-right">
          <Knob
            paramId={driveId}
            value={params[driveId]}
            size={42}
            color="#F59E0B"
            label="Drive"
            onBeginGesture={onBeginGesture}
            onDragChange={onDragChange}
            onEndGesture={onEndGesture}
            onDiscreteChange={onDiscreteChange}
          />
          <div className="mh-slot-subrow">
            <button
              type="button"
              className={`mh-pill-btn ${x2Active ? "is-active" : ""}`}
              aria-pressed={x2Active}
              onClick={() => onDiscreteChange(x2Id, x2Active ? 0 : 1)}
            >
              X2
            </button>
            <Knob
              paramId={harmonicId}
              value={params[harmonicId]}
              size={34}
              color="#4ADE80"
              label="Harmonic Exp"
              onBeginGesture={onBeginGesture}
              onDragChange={onDragChange}
              onEndGesture={onEndGesture}
              onDiscreteChange={onDiscreteChange}
            />
          </div>
        </div>
      </div>

      <div className="mh-select-wrap">
        <select
          aria-label={`Slot ${slotNum} Emulation Type`}
          value={NEURAL_TYPES[typeIdx]}
          onChange={(e) => {
            const idx = NEURAL_TYPES.indexOf(e.target.value as (typeof NEURAL_TYPES)[number]);
            if (idx >= 0) onDiscreteChange(typeId, choiceToNormalized(idx, NEURAL_TYPES.length));
          }}
        >
          {NEURAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="mh-select-chevron" aria-hidden="true">
          ▼
        </span>
      </div>
    </section>
  );
}

interface FilterCardProps extends ControlHandlers {
  title: string;
  prefix: "hpf" | "lpf";
  params: ParamMap;
}

function FilterCard({ title, prefix, params, ...handlers }: FilterCardProps) {
  const { onBeginGesture, onDragChange, onEndGesture, onDiscreteChange } = handlers;
  const freqId = `${prefix}.freq` as ParamId;
  const resId = `${prefix}.resonance` as ParamId;
  const driveId = `${prefix}.drive` as ParamId;
  const slopeId = `${prefix}.slope` as ParamId;
  const slopeIdx = normalizedToChoiceIndex(params[slopeId], FILTER_SLOPES.length);

  return (
    <section className="mh-card mh-filter-card" aria-label={title}>
      <h2 className="mh-card-title">{title}</h2>
      <div className="mh-filter-body">
        <Knob
          paramId={freqId}
          value={params[freqId]}
          size={48}
          color="#38BDF8"
          label="Frequency"
          onBeginGesture={onBeginGesture}
          onDragChange={onDragChange}
          onEndGesture={onEndGesture}
          onDiscreteChange={onDiscreteChange}
        />

        <div className="mh-filter-sliders">
          <label className="mh-slider-row">
            <span className="mh-slider-label">Resonance</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(params[resId] * 100)}
              onPointerDown={() => onBeginGesture(resId)}
              onChange={(e) => onDragChange(resId, Number(e.target.value) / 100)}
              onPointerUp={() => onEndGesture(resId)}
            />
            <span className="mh-slider-val">{PARAM_SPEC[resId].format(params[resId])}</span>
          </label>

          <label className="mh-slider-row">
            <span className="mh-slider-label">Analog Drive</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(params[driveId] * 100)}
              onPointerDown={() => onBeginGesture(driveId)}
              onChange={(e) => onDragChange(driveId, Number(e.target.value) / 100)}
              onPointerUp={() => onEndGesture(driveId)}
            />
            <span className="mh-slider-val">{PARAM_SPEC[driveId].format(params[driveId])}</span>
          </label>

          <div className="mh-slope-row" role="group" aria-label={`${title} Slope`}>
            <span className="mh-slider-label">Slope</span>
            <div className="mh-slope-buttons">
              {FILTER_SLOPES.map((s, idx) => {
                const active = idx === slopeIdx;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    className={`mh-pill-btn ${active ? "is-active" : ""}`}
                    onClick={() => onDiscreteChange(slopeId, choiceToNormalized(idx, FILTER_SLOPES.length))}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

function ToggleSwitch({ label, checked, onToggle }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="mh-toggle-btn"
      onClick={() => onToggle(!checked)}
    >
      <span className={`mh-toggle-track ${checked ? "is-on" : ""}`}>
        <span className="mh-toggle-thumb" />
      </span>
      <span className={`mh-toggle-label ${checked ? "is-on" : ""}`}>{label}</span>
    </button>
  );
}

export default function MohitsPro1({ host: injectedHost }: MohitsPro1Props) {
  const host = useMemo(() => injectedHost ?? createBrowserHostAdapter(), [injectedHost]);
  const writeQueue = useMemo(() => new HostWriteQueue(host), [host]);
  const controller = useMemo(() => new PluginController(writeQueue), [writeQueue]);

  const [pluginState, setPluginState] = useState<PluginState>(() => controller.getState());
  const [meterFrame, setMeterFrame] = useState<MeterFrame | null>(null);
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubState = controller.subscribe(setPluginState);
    const unsubParams = host.subscribeParams((patch) => controller.applyHostPatch(patch));
    const unsubMeters = host.subscribeMeters(setMeterFrame);

    let mounted = true;
    Promise.resolve(host.getAllParams()).then((initial) => {
      if (mounted && initial) controller.applyHostPatch(initial);
    });

    return () => {
      mounted = false;
      unsubState();
      unsubParams();
      unsubMeters();
      writeQueue.dispose();
    };
  }, [controller, host, writeQueue]);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        controller.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        controller.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  const params = pluginState.snapshots[pluginState.activeSlot];
  const inactiveSlot = pluginState.activeSlot === "A" ? "B" : "A";
  const isCustom = pluginState.presetName === CUSTOM_PRESET;
  const isUserPreset = pluginState.userPresetNames.includes(pluginState.presetName);
  const isJuce = typeof window !== "undefined" && window.__JUCE__ !== undefined;
  const relayCount = useMemo(() => countJuceRelays(), []);

  const handlers: ControlHandlers = {
    onBeginGesture: (id) => controller.beginEdit(id),
    onDragChange: (id, v) => controller.setParamContinuous(id, v),
    onEndGesture: (id) => controller.endEdit(id),
    onDiscreteChange: (id, v) => controller.setParamDiscrete(id, v),
  };

  const channelModeIdx = normalizedToChoiceIndex(params["routing.channelMode"], CHANNEL_MODES.length);
  const qualityIdx = normalizedToChoiceIndex(params["master.quality"], QUALITY_MODES.length);

  const handleSave = () => {
    const err = controller.saveUserPreset(saveName);
    setNotice(err ?? `Saved "${saveName.trim()}".`);
    if (!err) setSaveName("");
  };

  const handleExport = () => {
    const blob = new Blob([controller.exportActivePreset()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pluginState.presetName === CUSTOM_PRESET ? "custom" : pluginState.presetName}.mohitspreset.json`
      .replace(/[^\w.-]+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Preset exported.");
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const name = controller.importPreset(await file.text());
      setNotice(`Imported "${name}".`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Import failed.");
    }
  };

  return (
    <div className="mh-shell">
      <div className="mh-chassis">
        {/* TOP HEADER */}
        <header className="mh-topbar">
          <span className="mh-brand">MOHITS</span>

          <div className="mh-topbar-controls">
            <div className="mh-select-wrap mh-preset-select">
              <select
                aria-label="Preset"
                value={isCustom ? "" : pluginState.presetName}
                onChange={(e) => controller.selectPreset(e.target.value)}
              >
                {isCustom && (
                  <option value="" disabled>
                    Custom (Modified)
                  </option>
                )}
                <optgroup label="Built-in">
                  {Object.keys(PRESET_OVERRIDES).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
                {pluginState.userPresetNames.length > 0 && (
                  <optgroup label="Saved">
                    {pluginState.userPresetNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="mh-select-chevron" aria-hidden="true">
                ▼
              </span>
            </div>

            <button
              type="button"
              className={`mh-header-btn ${pluginState.activeSlot === "B" ? "is-active" : ""}`}
              onClick={() => controller.switchAB()}
            >
              A / B ({pluginState.activeSlot})
            </button>

            <button type="button" className="mh-header-btn" onClick={() => controller.undo()} disabled={!pluginState.canUndo}>
              Undo
            </button>
            <button type="button" className="mh-header-btn" onClick={() => controller.redo()} disabled={!pluginState.canRedo}>
              Redo
            </button>
            <button type="button" className="mh-header-btn" onClick={() => controller.revertToPreset()} disabled={isCustom}>
              Revert
            </button>
            <button type="button" className="mh-header-btn" onClick={() => controller.resetToDefaults()}>
              Reset
            </button>
          </div>

          <span className="mh-model">
            PRO <span className="mh-accent">1</span>
          </span>
        </header>

        {/* UTILITY ROW: copy, save, import/export */}
        <div className="mh-utility-row" role="toolbar" aria-label="Preset utilities">
          <button type="button" className="mh-header-btn" onClick={() => controller.copyActiveToOther()}>
            Copy {pluginState.activeSlot} → {inactiveSlot}
          </button>

          <form
            className="mh-save-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <input
              type="text"
              aria-label="New preset name"
              placeholder="Name this preset"
              maxLength={60}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <button type="submit" className="mh-header-btn">
              Save preset
            </button>
          </form>

          {isUserPreset && (
            <button
              type="button"
              className="mh-header-btn"
              onClick={() => {
                controller.deleteUserPreset(pluginState.presetName);
                setNotice("Preset deleted.");
              }}
            >
              Delete preset
            </button>
          )}

          <button type="button" className="mh-header-btn" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="mh-header-btn" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={handleImport}
            aria-label="Import preset file"
          />

          <span className="mh-notice" role="status">
            {notice ?? ""}
          </span>
        </div>

        {/* MASTER STRIP */}
        <section className="mh-card mh-master-strip" aria-label="Master">
          <Knob
            paramId="master.inputGain"
            value={params["master.inputGain"]}
            size={48}
            color="#38BDF8"
            label="Input Trim"
            onBeginGesture={handlers.onBeginGesture}
            onDragChange={handlers.onDragChange}
            onEndGesture={handlers.onEndGesture}
            onDiscreteChange={handlers.onDiscreteChange}
          />
          <Knob
            paramId="master.outputGain"
            value={params["master.outputGain"]}
            size={48}
            color="#38BDF8"
            label="Output Trim"
            onBeginGesture={handlers.onBeginGesture}
            onDragChange={handlers.onDragChange}
            onEndGesture={handlers.onEndGesture}
            onDiscreteChange={handlers.onDiscreteChange}
          />
          <Knob
            paramId="master.mix"
            value={params["master.mix"]}
            size={48}
            color="#4ADE80"
            label="Dry / Wet"
            onBeginGesture={handlers.onBeginGesture}
            onDragChange={handlers.onDragChange}
            onEndGesture={handlers.onEndGesture}
            onDiscreteChange={handlers.onDiscreteChange}
          />

          <ToggleSwitch
            label="Bypass"
            checked={params["master.bypass"] >= 0.5}
            onToggle={(next) => handlers.onDiscreteChange("master.bypass", next ? 1 : 0)}
          />
          <ToggleSwitch
            label="Level Match"
            checked={params["master.levelMatch"] >= 0.5}
            onToggle={(next) => handlers.onDiscreteChange("master.levelMatch", next ? 1 : 0)}
          />

          <div className="mh-quality" role="radiogroup" aria-label="Oversampling quality">
            <span className="mh-slider-label">Quality</span>
            <div className="mh-slope-buttons">
              {QUALITY_MODES.map((q, idx) => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={idx === qualityIdx}
                  className={`mh-pill-btn ${idx === qualityIdx ? "is-active" : ""}`}
                  onClick={() => handlers.onDiscreteChange("master.quality", choiceToNormalized(idx, QUALITY_MODES.length))}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* MAIN RACK GRID */}
        <main className="mh-rack">
          <div className="mh-meter-left">
            <VUMeter side="left" meterFrame={meterFrame} />
          </div>

          <div className="mh-center-col">
            <div className="mh-slots-grid">
              {([1, 2, 3, 4] as const).map((slotNum) => (
                <NeuralSlotCard key={slotNum} slotNum={slotNum} params={params} {...handlers} />
              ))}
            </div>

            <section className="mh-card mh-eq-stage" aria-label="One Knob EQ and Sweet Spot">
              <svg className="mh-pcb-bg" aria-hidden="true" viewBox="0 0 600 140" preserveAspectRatio="none">
                <path
                  d="M0 30 H110 L130 50 H240 M600 35 H480 L460 55 H360 M0 110 H95 L120 85 H220 M600 105 H490 L470 85 H380"
                  fill="none"
                  stroke="#4B5563"
                  strokeWidth="1.2"
                />
                <circle cx="240" cy="50" r="2.5" fill="#4B5563" />
                <circle cx="360" cy="55" r="2.5" fill="#4B5563" />
              </svg>

              <div className="mh-eq-dial-wrap">
                <Knob
                  paramId="eq.character"
                  value={params["eq.character"]}
                  size={76}
                  large
                  gradientStops={["#F59E0B", "#4ADE80"]}
                  onBeginGesture={handlers.onBeginGesture}
                  onDragChange={handlers.onDragChange}
                  onEndGesture={handlers.onEndGesture}
                  onDiscreteChange={handlers.onDiscreteChange}
                />
                <span className="mh-eq-caption">One Knob EQ</span>
              </div>

              <Knob
                paramId="eq.tilt"
                value={params["eq.tilt"]}
                size={90}
                large
                gradientStops={["#38BDF8", "#7DD3FC"]}
                label="Tilt"
                onBeginGesture={handlers.onBeginGesture}
                onDragChange={handlers.onDragChange}
                onEndGesture={handlers.onEndGesture}
                onDiscreteChange={handlers.onDiscreteChange}
              />

              <Knob
                paramId="eq.sweetSpot"
                value={params["eq.sweetSpot"]}
                size={80}
                large
                gradientStops={["#F59E0B", "#4ADE80"]}
                bottomLeft="-"
                bottomRight="+"
                label="Sweet Spot"
                onBeginGesture={handlers.onBeginGesture}
                onDragChange={handlers.onDragChange}
                onEndGesture={handlers.onEndGesture}
                onDiscreteChange={handlers.onDiscreteChange}
              />
            </section>

            <div className="mh-filters-grid">
              <FilterCard title="High Pass Filter" prefix="hpf" params={params} {...handlers} />
              <FilterCard title="Low Pass Filter" prefix="lpf" params={params} {...handlers} />
            </div>
          </div>

          <aside className="mh-card mh-routing-panel" aria-label="Routing and channel mode">
            <div className="mh-routing-group">
              <span className="mh-routing-heading">Pre / Post EQ and Filters</span>
              <ToggleSwitch
                label="Pre EQ"
                checked={params["routing.preEq"] >= 0.5}
                onToggle={(next) => handlers.onDiscreteChange("routing.preEq", next ? 1 : 0)}
              />
              <ToggleSwitch
                label="Post Filters"
                checked={params["routing.postFilters"] >= 0.5}
                onToggle={(next) => handlers.onDiscreteChange("routing.postFilters", next ? 1 : 0)}
              />
            </div>

            <div className="mh-routing-group mh-routing-divider" role="radiogroup" aria-label="Channel Mode">
              <ToggleSwitch
                label="Left / Right"
                checked={channelModeIdx === 0}
                onToggle={() => handlers.onDiscreteChange("routing.channelMode", 0)}
              />
              <ToggleSwitch
                label="Mid / Side"
                checked={channelModeIdx === 1}
                onToggle={() => handlers.onDiscreteChange("routing.channelMode", 1)}
              />
            </div>

            <span className="mh-serial">MHTS1-0001</span>
          </aside>

          <div className="mh-meter-right">
            <VUMeter side="right" meterFrame={meterFrame} />
          </div>
        </main>

        {/* FOOTER */}
        <footer className="mh-footer">
          <span>
            Host: {isJuce ? `JUCE, relays ${relayCount}/${PARAM_IDS.length}` : "Preview (no plugin host)"}
          </span>
          <span>Active slot: {pluginState.activeSlot}</span>
        </footer>
      </div>
    </div>
  );
}
