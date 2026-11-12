import { useEffect, useRef, useState } from 'react';
import { METER_FLOOR_DB, createMeterState, dbToPos, stepMeter, type MeterState } from '../meters/ballistics';
import type { MeterFrame } from '../host/host';
import { useParams } from '../state/ParamContext';

const TICKS_DB = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60];

const pick = (f: MeterFrame, source: 'in' | 'out'): [number, number] =>
  source === 'in' ? [f.inL, f.inR] : [f.outL, f.outR];

/**
 * Stereo peak meter, dBFS scale. Updates bar heights directly (no React re-render per frame).
 * With no host meter data it shows NO SIGNAL and falls to the floor. It never animates fake signal.
 */
export function Meter({ title, source }: { title: string; source: 'in' | 'out' }) {
  const { host } = useParams();
  const fills = useRef<(HTMLDivElement | null)[]>([null, null]);
  const holds = useRef<(HTMLDivElement | null)[]>([null, null]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const states: MeterState[] = [createMeterState(), createMeterState()];
    let last = performance.now();
    let isLive = false;
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;

      const frame = host.meters();
      if ((frame !== null) !== isLive) {
        isLive = frame !== null;
        setLive(isLive);
      }
      const pair = frame ? pick(frame, source) : [0, 0];

      for (let ch = 0; ch < 2; ch++) {
        const s = stepMeter(states[ch], pair[ch], dt);
        states[ch] = s;
        const fill = fills.current[ch];
        const hold = holds.current[ch];
        if (fill) fill.style.height = `${dbToPos(s.level) * 100}%`;
        if (hold) hold.style.bottom = `${dbToPos(s.hold) * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [host, source]);

  return (
    <section className="meter" aria-label={`${title} meter`}>
      <header className="meter__head">
        <span>{title}</span>
        <span className={`meter__state${live ? ' is-live' : ''}`}>{live ? 'LIVE' : 'NO SIGNAL'}</span>
      </header>
      <div className="meter__body">
        <div className="meter__scale" aria-hidden="true">
          {TICKS_DB.map((db) => (
            <span key={db} style={{ bottom: `${dbToPos(db) * 100}%` }}>
              {db === 0 ? '0' : db}
            </span>
          ))}
        </div>
        {[0, 1].map((ch) => (
          <div key={ch} className="meter__channel">
            <div className="meter__track">
              <div
                className="meter__fill"
                ref={(el) => {
                  fills.current[ch] = el;
                }}
                style={{ height: `${dbToPos(METER_FLOOR_DB) * 100}%` }}
              />
              <div
                className="meter__hold"
                ref={(el) => {
                  holds.current[ch] = el;
                }}
              />
            </div>
            <span className="meter__ch">{ch === 0 ? 'L' : 'R'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
