import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp01 } from '../util';

export interface KnobProps {
  /** Visible label. */
  label: string;
  /** Accessible name. Use this when the visible label isn't unique on screen. */
  ariaLabel?: string;
  value: number;
  defaultValue: number;
  format: (v: number) => string;
  accent: string;
  size?: number;
  ticks?: boolean;
  onChange: (v: number) => void;
  onBegin: () => void;
  onEnd: () => void;
}

const START_DEG = -135;
const SPAN_DEG = 270;

const angleOf = (v: number): number => START_DEG + clamp01(v) * SPAN_DEG;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

export function Knob(props: KnobProps) {
  const { label, ariaLabel, value, defaultValue, format, accent, size = 46, ticks = false, onChange, onBegin, onEnd } =
    props;

  const uid = 'k' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const rootRef = useRef<HTMLDivElement>(null);

  // Handlers read the latest props through this ref, so long-lived native listeners never go stale.
  const latest = useRef({ value, onChange, onBegin, onEnd });
  latest.current = { value, onChange, onBegin, onEnd };

  const drag = useRef<{ y: number; v: number; fine: boolean } | null>(null);
  const keyHeld = useRef(false);
  const wheel = useRef<{ open: boolean; timer?: number }>({ open: false });

  // Native wheel listener with { passive: false }, so preventDefault actually stops page scroll.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const w = wheel.current;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = latest.current;
      if (!w.open) {
        cur.onBegin();
        w.open = true;
      }
      const step = (e.shiftKey ? 0.005 : 0.025) * (e.deltaY < 0 ? 1 : -1);
      const next = clamp01(cur.value + step);
      latest.current.value = next;
      cur.onChange(next);
      window.clearTimeout(w.timer);
      w.timer = window.setTimeout(() => {
        w.open = false;
        latest.current.onEnd();
      }, 250);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(w.timer);
      if (w.open) {
        w.open = false;
        latest.current.onEnd();
      }
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    rootRef.current?.focus();
    drag.current = { y: e.clientY, v: latest.current.value, fine: e.shiftKey };
    latest.current.onBegin();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Re-anchor when fine mode toggles, so the value doesn't jump.
    if (e.shiftKey !== d.fine) {
      d.y = e.clientY;
      d.v = latest.current.value;
      d.fine = e.shiftKey;
    }
    const sensitivity = d.fine ? 520 : 150;
    const next = clamp01(d.v + (d.y - e.clientY) / sensitivity);
    if (next !== latest.current.value) {
      latest.current.value = next;
      latest.current.onChange(next);
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
    latest.current.onEnd();
  };

  const onDoubleClick = () => {
    latest.current.onBegin();
    latest.current.onChange(defaultValue);
    latest.current.onEnd();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    const cur = latest.current.value;
    const fine = e.shiftKey ? 0.01 : 0.05;
    let next: number;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = cur + fine;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = cur - fine;
        break;
      case 'PageUp':
        next = cur + 0.1;
        break;
      case 'PageDown':
        next = cur - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      default:
        next = 1; // End
    }
    e.preventDefault();
    if (!keyHeld.current) {
      keyHeld.current = true;
      latest.current.onBegin();
    }
    const v = clamp01(next);
    latest.current.value = v;
    latest.current.onChange(v);
  };

  const releaseKey = () => {
    if (!keyHeld.current) return;
    keyHeld.current = false;
    latest.current.onEnd();
  };

  const angle = angleOf(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const [sx, sy] = polar(cx, cy, r, START_DEG);
  const [ex, ey] = polar(cx, cy, r, START_DEG + SPAN_DEG);
  const [vx, vy] = polar(cx, cy, r, angle);
  const [ix, iy] = polar(cx, cy, r - 7, angle);
  const trackPath = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`;
  const valuePath =
    clamp01(value) > 0.001 ? `M ${sx} ${sy} A ${r} ${r} 0 ${angle - START_DEG > 180 ? 1 : 0} 1 ${vx} ${vy}` : '';

  return (
    <div
      ref={rootRef}
      className="knob"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel ?? label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp01(value) * 100)}
      aria-valuetext={format(value)}
      style={{ width: size }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={releaseKey}
      onBlur={releaseKey}
    >
      <svg width={size} height={size} aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${uid}-cap`} cx="38%" cy="32%">
            <stop offset="0%" stopColor="#4B525C" />
            <stop offset="60%" stopColor="#20242A" />
            <stop offset="100%" stopColor="#0D0F12" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r + 3} fill="#090B0D" stroke="#2D323A" strokeWidth={1} />
        <path d={trackPath} fill="none" stroke="#1B1F24" strokeWidth={3} strokeLinecap="round" />
        {valuePath && (
          <path d={valuePath} fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" />
        )}
        {ticks &&
          Array.from({ length: 11 }, (_, i) => {
            const a = START_DEG + (i / 10) * SPAN_DEG;
            const [x1, y1] = polar(cx, cy, r - 1, a);
            const [x2, y2] = polar(cx, cy, r - 4, a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3A414B" strokeWidth={1} />;
          })}
        <circle cx={cx} cy={cy} r={r - 4} fill={`url(#${uid}-cap)`} stroke="#14171C" strokeWidth={1.2} />
        <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r * 0.3} fill="#101216" stroke="#2E333B" strokeWidth={1} />
      </svg>
      <span className="knob__label">{label}</span>
      <output className="knob__value" aria-hidden="true">
        {format(value)}
      </output>
    </div>
  );
}
