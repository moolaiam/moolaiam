"""Text conditioning: prompt + structured tags + lyrics -> shared audio-text embedding.

Production deployments plug a CLAP-family encoder (e.g. LAION-CLAP or a
MusicCLAP-style model) into `TextEncoder`. The reference `HashingTextEncoder`
below is a deterministic, dependency-free stand-in with the same contract:
L2-normalised vectors of fixed dimension, where similar texts land close in
cosine space. It is NOT a semantic model and must not be used for quality
claims.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Protocol, Sequence

import numpy as np

from musicengine.config import CodecConfig
from musicengine.schemas import GenerationRequest

_WORD = re.compile(r"[a-z0-9']+")


class TextEncoder(Protocol):
    dim: int

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        """Return float32 array of shape (len(texts), dim), rows L2-normalised."""
        ...


class HashingTextEncoder:
    """Feature-hashing encoder over word unigrams, bigrams and char 3-grams."""

    def __init__(self, dim: int = 512) -> None:
        self.dim = dim

    def _features(self, text: str) -> list[str]:
        words = _WORD.findall(text.lower())
        feats = [f"w:{w}" for w in words]
        feats += [f"b:{a}_{b}" for a, b in zip(words, words[1:])]
        padded = f"  {' '.join(words)} "
        feats += [f"c:{padded[i:i + 3]}" for i in range(len(padded) - 2)]
        return feats

    def _bucket(self, feat: str) -> tuple[int, float]:
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "little")
        sign = 1.0 if (value >> 63) & 1 else -1.0
        return value % self.dim, sign

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for feat in self._features(text):
                idx, sign = self._bucket(feat)
                out[row, idx] += sign
            norm = np.linalg.norm(out[row])
            if norm > 0:
                out[row] /= norm
        return out


@dataclass(frozen=True)
class SectionPlan:
    name: str
    frames: int
    lyric_text: str


@dataclass(frozen=True)
class Conditioning:
    text_embedding: np.ndarray        # (dim,) float32, unit norm
    canonical_text: str
    sections: tuple[SectionPlan, ...]
    total_frames: int
    tempo_bpm: int | None
    key: str | None


def canonical_text(req: GenerationRequest) -> str:
    """Deterministic textual rendering of all user conditioning fields.

    Structured tags are rendered as labelled fields so the encoder sees the
    same layout for every request, which makes embeddings comparable.
    """
    parts = [f"prompt: {req.prompt.strip()}"]
    if req.genres:
        parts.append("genre: " + ", ".join(req.genres))
    if req.moods:
        parts.append("mood: " + ", ".join(req.moods))
    if req.instruments:
        parts.append("instruments: " + ", ".join(req.instruments))
    if req.tempo_bpm:
        parts.append(f"tempo: {req.tempo_bpm} bpm")
    if req.key:
        parts.append(f"key: {req.key}")
    parts.append("vocals: none" if req.instrumental else "vocals: yes")
    return " | ".join(parts)


def plan_sections(req: GenerationRequest, total_frames: int, frame_rate_hz: int) -> tuple[SectionPlan, ...]:
    """Allocate the total frame budget across song sections.

    Lyric sections are weighted by word count (so a dense verse gets more
    time than a short chorus hook). Instrumentals get a conventional
    intro / body / outro arc. Allocation is exact: frames always sum to
    `total_frames`.
    """
    if total_frames <= 0:
        raise ValueError("total_frames must be positive")
    sections = req.lyric_sections()
    if not sections:
        sections = [
            ("intro", ""),
            ("verse", ""),
            ("chorus", ""),
            ("verse", ""),
            ("chorus", ""),
            ("outro", ""),
        ]
        weights = [0.6, 1.0, 1.0, 1.0, 1.0, 0.6]
    else:
        weights = [max(1, len(body.split())) for _, body in sections]
    total_weight = float(sum(weights))
    raw = [total_frames * w / total_weight for w in weights]
    frames = [int(np.floor(x)) for x in raw]
    remainder = total_frames - sum(frames)
    order = np.argsort([-(r - np.floor(r)) for r in raw], kind="stable")
    for i in order[:remainder]:
        frames[i] += 1
    # Every section must hold at least one frame.
    for i, f in enumerate(frames):
        if f == 0:
            frames[i] = 1
            donor = int(np.argmax(frames))
            frames[donor] -= 1
    plan = tuple(SectionPlan(n, f, b) for (n, b), f in zip(sections, frames))
    _ = frame_rate_hz  # reserved for min-duration constraints per section type
    return plan


class ConditioningService:
    def __init__(self, encoder: TextEncoder, codec_cfg: CodecConfig) -> None:
        self.encoder = encoder
        self.codec_cfg = codec_cfg

    def condition(self, req: GenerationRequest) -> Conditioning:
        text = canonical_text(req)
        emb = self.encoder.encode([text])[0]
        total_frames = int(np.ceil(req.duration_seconds * self.codec_cfg.frame_rate_hz))
        sections = plan_sections(req, total_frames, self.codec_cfg.frame_rate_hz)
        return Conditioning(
            text_embedding=emb,
            canonical_text=text,
            sections=sections,
            total_frames=total_frames,
            tempo_bpm=req.tempo_bpm,
            key=req.key,
        )
