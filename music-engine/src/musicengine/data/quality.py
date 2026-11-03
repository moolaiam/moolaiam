"""Signal-quality filters for raw audio before it enters training.

Metrics (all computed on the mono mix unless noted):
  * corrupt      - any NaN / Inf sample
  * duration     - seconds; below minimum rejected
  * silence      - fraction of 2048-sample frames with RMS < -60 dBFS
  * clipping     - fraction of samples with |x| >= 0.999
  * loudness     - overall RMS in dBFS
  * snr_db       - spectral SNR proxy: per-bin 10th-percentile power is taken
                   as the noise floor; SNR = total power / total floor. Steady
                   broadband noise scores low; time-varying tonal content
                   scores high.
  * bandwidth_hz - frequency below which 99% of average spectral power lies;
                   catches band-limited, low-bitrate or upsampled sources.

Thresholds are data, not code: they live in `QualityThresholds` so curation
runs can be reproduced and their settings recorded in the manifest.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

FRAME = 2048
HOP = 1024
SILENCE_DB = -60.0


@dataclass(frozen=True)
class QualityThresholds:
    min_duration_s: float = 10.0
    max_silence_ratio: float = 0.5
    max_clip_ratio: float = 0.001
    min_rms_dbfs: float = -40.0
    min_snr_db: float = 15.0
    min_bandwidth_hz: float = 11_000.0


@dataclass(frozen=True)
class QualityReport:
    passed: bool
    reasons: tuple[str, ...]
    metrics: dict[str, float]

    def to_dict(self) -> dict:
        return {"passed": self.passed, "reasons": list(self.reasons), "metrics": self.metrics}


def _frames(x: np.ndarray, size: int, hop: int) -> np.ndarray:
    if x.size < size:
        x = np.pad(x, (0, size - x.size))
    n = 1 + (x.size - size) // hop
    idx = np.arange(size)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def _spectral_snr_and_bandwidth(mono: np.ndarray, sr: int) -> tuple[float, float]:
    frames = _frames(mono, FRAME, HOP) * np.hanning(FRAME)[None, :]
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2 + 1e-12   # (frames, bins)
    total = power.mean(axis=0)
    floor = np.percentile(power, 10, axis=0)
    snr = 10.0 * np.log10(total.sum() / max(floor.sum(), 1e-12))
    # Effective bandwidth: highest bin whose average power is within 70 dB of the
    # spectral peak. A cumulative-power rolloff would sit near 3 kHz for almost all
    # music (bass dominates energy), whereas an encoder lowpass shows as a cliff.
    avg_db = 10.0 * np.log10(total)
    audible = np.nonzero(avg_db > avg_db.max() - 70.0)[0]
    bandwidth = float(audible[-1] * sr / FRAME) if audible.size else 0.0
    return float(snr), bandwidth


def assess_audio(audio: np.ndarray, sample_rate: int, thr: QualityThresholds | None = None) -> QualityReport:
    """Assess a (channels, samples) float array. Returns a report; never raises on bad audio."""
    thr = thr or QualityThresholds()
    if audio.ndim != 2 or audio.size == 0:
        return QualityReport(False, ("empty_or_malformed",), {})
    if not np.all(np.isfinite(audio)):
        return QualityReport(False, ("corrupt_samples",), {})

    mono = audio.mean(axis=0).astype(np.float64)
    duration = mono.size / sample_rate
    frame_rms = np.sqrt(np.mean(_frames(mono, FRAME, FRAME) ** 2, axis=1) + 1e-20)
    silence_ratio = float(np.mean(20 * np.log10(frame_rms) < SILENCE_DB))
    clip_ratio = float(np.mean(np.abs(audio) >= 0.999))
    rms_db = float(20 * np.log10(np.sqrt(np.mean(mono**2)) + 1e-20))
    snr, bandwidth = _spectral_snr_and_bandwidth(mono, sample_rate)

    metrics = {
        "duration_s": duration,
        "silence_ratio": silence_ratio,
        "clip_ratio": clip_ratio,
        "rms_dbfs": rms_db,
        "snr_db": snr,
        "bandwidth_hz": bandwidth,
    }
    reasons: list[str] = []
    if duration < thr.min_duration_s:
        reasons.append("too_short")
    if silence_ratio > thr.max_silence_ratio:
        reasons.append("mostly_silent")
    if clip_ratio > thr.max_clip_ratio:
        reasons.append("clipped")
    if rms_db < thr.min_rms_dbfs:
        reasons.append("too_quiet")
    if snr < thr.min_snr_db:
        reasons.append("low_snr")
    if bandwidth < thr.min_bandwidth_hz:
        reasons.append("low_bandwidth")
    return QualityReport(not reasons, tuple(reasons), metrics)


def thresholds_as_dict(thr: QualityThresholds) -> dict:
    return asdict(thr)
