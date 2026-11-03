"""WAV I/O using only the standard library (16-bit PCM)."""

from __future__ import annotations

import io
import wave
from pathlib import Path

import numpy as np


def encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    """(C, T) float in [-1, 1] -> 16-bit PCM WAV bytes."""
    if audio.ndim != 2:
        raise ValueError("audio must be (channels, samples)")
    channels, _ = audio.shape
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped.T * 32767.0).round().astype("<i2")  # interleave: (T, C)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV bytes -> ((C, T) float32, sample_rate)."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getsampwidth() != 2:
                raise ValueError("only 16-bit PCM WAV is supported")
            channels = w.getnchannels()
            rate = w.getframerate()
            raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    except wave.Error as exc:  # malformed container -> uniform ValueError for callers
        raise ValueError(f"malformed WAV: {exc}") from exc
    samples = raw.reshape(-1, channels).T.astype(np.float32) / 32767.0
    return samples, rate


def read_wav_file(path: str | Path) -> tuple[np.ndarray, int]:
    return decode_wav(Path(path).read_bytes())
