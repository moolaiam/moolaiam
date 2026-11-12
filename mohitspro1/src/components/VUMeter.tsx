import { useEffect, useRef } from "react";
import {
  createChannelBallisticsState,
  DB_SCALE_TICKS,
  dbToNormalized,
  stepChannelBallistics,
} from "../audio/meters.ts";
import type { MeterFrame } from "../host/bridge.ts";

interface VUMeterProps {
  side: "left" | "right";
  meterFrame: MeterFrame | null;
}

export function VUMeter({ side, meterFrame }: VUMeterProps) {
  const hasSignal = meterFrame !== null;
  const dbfsBarRef = useRef<HTMLDivElement | null>(null);
  const vuBarRef = useRef<HTMLDivElement | null>(null);
  const dbfsHoldRef = useRef<HTMLDivElement | null>(null);
  const vuHoldRef = useRef<HTMLDivElement | null>(null);

  const frameRef = useRef<MeterFrame | null>(meterFrame);
  frameRef.current = meterFrame;

  const stateRef = useRef({
    dbfs: createChannelBallisticsState(),
    vu: createChannelBallisticsState(),
  });

  useEffect(() => {
    let rafId = 0;
    let lastTimeMs: number | null = null;

    const tick = (nowMs: number) => {
      const dtSec = lastTimeMs === null ? 1 / 60 : Math.min(0.1, Math.max(0, (nowMs - lastTimeMs) / 1000));
      lastTimeMs = nowMs;

      const current = frameRef.current;
      if (current) {
        const target = side === "left" ? current.left : current.right;
        stateRef.current.dbfs = stepChannelBallistics(stateRef.current.dbfs, target.dbfsDb, dtSec);
        stateRef.current.vu = stepChannelBallistics(stateRef.current.vu, target.vuDb, dtSec);
      } else {
        stateRef.current.dbfs = createChannelBallisticsState();
        stateRef.current.vu = createChannelBallisticsState();
      }

      const dbfsNorm = dbToNormalized(stateRef.current.dbfs.levelDb);
      const vuNorm = dbToNormalized(stateRef.current.vu.levelDb);
      const dbfsHoldNorm = dbToNormalized(stateRef.current.dbfs.peakHoldDb);
      const vuHoldNorm = dbToNormalized(stateRef.current.vu.peakHoldDb);

      if (dbfsBarRef.current) dbfsBarRef.current.style.transform = `scaleY(${dbfsNorm})`;
      if (vuBarRef.current) vuBarRef.current.style.transform = `scaleY(${vuNorm})`;
      if (dbfsHoldRef.current) dbfsHoldRef.current.style.bottom = `${dbfsHoldNorm * 100}%`;
      if (vuHoldRef.current) vuHoldRef.current.style.bottom = `${vuHoldNorm * 100}%`;

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [side]);

  return (
    <div className="mh-meter-panel" aria-label={`${side} channel meter`}>
      <div className="mh-meter-headers">
        <span>dBFS</span>
        <span>VU</span>
      </div>

      <div className="mh-meter-columns">
        <div className="mh-meter-track">
          <div ref={dbfsBarRef} className="mh-meter-fill" />
          <div ref={dbfsHoldRef} className={`mh-meter-hold ${hasSignal ? "" : "is-hidden"}`} />
        </div>

        <div className="mh-meter-scale" aria-hidden="true">
          {DB_SCALE_TICKS.map((db) => (
            <span key={db} className={db === 0 ? "is-zero" : undefined}>
              {db}
            </span>
          ))}
        </div>

        <div className="mh-meter-track">
          <div ref={vuBarRef} className="mh-meter-fill" />
          <div ref={vuHoldRef} className={`mh-meter-hold ${hasSignal ? "" : "is-hidden"}`} />
        </div>
      </div>

      {!hasSignal ? (
        <div className="mh-no-signal" role="status">
          NO SIGNAL
        </div>
      ) : (
        <div className="mh-meter-headers">
          <span>dBFS</span>
          <span>VU</span>
        </div>
      )}
    </div>
  );
}
