import { useEffect, useId, useRef, useState } from "react";
import { clamp01, PARAM_SPEC, type ParamId } from "../params/spec.ts";

interface KnobProps {
  paramId: ParamId;
  value: number;
  size?: number;
  large?: boolean;
  color?: string;
  gradientStops?: readonly [string, string];
  label?: string;
  topLabel?: string;
  bottomLeft?: string;
  bottomRight?: string;
  onBeginGesture: (id: ParamId) => void;
  onDragChange: (id: ParamId, value: number) => void;
  onEndGesture: (id: ParamId) => void;
  onDiscreteChange: (id: ParamId, value: number) => void;
}

export function Knob({
  paramId,
  value,
  size = 46,
  large = false,
  color = "#38BDF8",
  gradientStops,
  label,
  topLabel,
  bottomLeft,
  bottomRight,
  onBeginGesture,
  onDragChange,
  onEndGesture,
  onDiscreteChange,
}: KnobProps) {
  const def = PARAM_SPEC[paramId];
  const capGradId = useId();
  const arcGradId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;

  const dragState = useRef({ active: false, startY: 0, startVal: value });

  const minAngle = -135;
  const maxAngle = 135;
  const clamped = clamp01(value);
  const angle = minAngle + clamped * (maxAngle - minAngle);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - (large ? 7 : 5);

  const toXY = (deg: number, radius = r): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };

  const arcPath = (): string => {
    if (Math.abs(angle - minAngle) < 0.5) return "";
    const [sx, sy] = toXY(minAngle);
    const [ex, ey] = toXY(angle);
    const largeArc = angle - minAngle > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
  };

  const [px, py] = toXY(angle, large ? r - 8 : r);

  // Non-passive wheel listener so preventDefault() works cleanly without warnings
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.shiftKey ? 0.005 : 0.025;
      const next = clamp01(valueRef.current + (e.deltaY < 0 ? step : -step));
      onDiscreteChange(paramId, next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [paramId, onDiscreteChange]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { active: true, startY: e.clientY, startVal: clamped };
    setDragging(true);
    onBeginGesture(paramId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const sensitivity = e.shiftKey ? 520 : 140;
    const delta = (dragState.current.startY - e.clientY) / sensitivity;
    const next = clamp01(dragState.current.startVal + delta);
    onDragChange(paramId, next);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    dragState.current.active = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture was already released
    }
    onEndGesture(paramId);
  };

  const handleDoubleClick = () => {
    onDiscreteChange(paramId, def.defaultValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const fine = e.shiftKey ? 0.005 : 0.025;
    let next: number | null = null;

    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = clamp01(clamped + fine);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = clamp01(clamped - fine);
        break;
      case "PageUp":
        next = clamp01(clamped + 0.1);
        break;
      case "PageDown":
        next = clamp01(clamped - 0.1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    onDiscreteChange(paramId, next);
  };

  const strokePaint = gradientStops ? `url(#${arcGradId})` : color;
  const formattedValue = def.format(clamped);

  return (
    <div
      ref={containerRef}
      className="mh-knob"
      role="slider"
      tabIndex={0}
      aria-label={def.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuetext={formattedValue}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {topLabel && <span className="mh-knob-top-label">{topLabel}</span>}

      <svg
        width={size}
        height={size}
        className="mh-knob-svg"
        style={{ filter: large ? "drop-shadow(0 6px 14px rgba(0,0,0,0.9))" : "drop-shadow(0 3px 6px rgba(0,0,0,0.85))" }}
      >
        <defs>
          <radialGradient id={capGradId} cx="38%" cy="32%">
            <stop offset="0%" stopColor="#545B66" />
            <stop offset="58%" stopColor="#22262C" />
            <stop offset="100%" stopColor="#0C0E11" />
          </radialGradient>
          {gradientStops && (
            <linearGradient id={arcGradId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gradientStops[0]} />
              <stop offset="100%" stopColor={gradientStops[1]} />
            </linearGradient>
          )}
        </defs>

        <circle cx={cx} cy={cy} r={r + (large ? 4 : 2.5)} fill="#08090B" stroke="#2D323A" strokeWidth={1.1} />
        <path
          d={`M ${toXY(minAngle)[0]} ${toXY(minAngle)[1]} A ${r} ${r} 0 1 1 ${toXY(maxAngle)[0]} ${toXY(maxAngle)[1]}`}
          fill="none"
          stroke="#191D22"
          strokeWidth={large ? 3.8 : 2.8}
          strokeLinecap="round"
        />
        {arcPath() && (
          <path
            d={arcPath()}
            fill="none"
            stroke={strokePaint}
            strokeWidth={large ? 3.8 : 2.8}
            strokeLinecap="round"
          />
        )}
        <circle cx={cx} cy={cy} r={r - (large ? 4.5 : 3.5)} fill={`url(#${capGradId})`} stroke="#14171C" strokeWidth={1.2} />
        {large &&
          Array.from({ length: 13 }).map((_, i) => {
            const a = -135 + (i / 12) * 270;
            const [x1, y1] = toXY(a, r - 5);
            const [x2, y2] = toXY(a, r - 11);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#16191D" strokeWidth={1.2} />;
          })}
        {large ? (
          <line
            x1={cx}
            y1={cy}
            x2={px}
            y2={py}
            stroke={dragging ? "#FFFFFF" : gradientStops?.[0] ?? color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ) : (
          <circle cx={px} cy={py} r={2.2} fill={color} />
        )}
        <circle cx={cx} cy={cy} r={r * (large ? 0.34 : 0.24)} fill="#101216" stroke="#2E333B" strokeWidth={0.9} />
      </svg>

      {(bottomLeft || bottomRight) && (
        <div className="mh-knob-bounds" style={{ width: size }}>
          <span>{bottomLeft}</span>
          <span>{bottomRight}</span>
        </div>
      )}

      {label && <span className="mh-knob-label">{label}</span>}
      <span className={`mh-knob-readout ${dragging ? "is-active" : ""}`}>{formattedValue}</span>
    </div>
  );
}
