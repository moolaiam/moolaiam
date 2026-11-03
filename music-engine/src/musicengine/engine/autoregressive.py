"""Autoregressive token engine: decoder-only next-token prediction over RVQ codes.

Vocabulary layout
    0 PAD | 1 BOS | 2 EOS | 3.. section markers | then Q * K acoustic tokens

Acoustic tokens are interleaved frame-major: frame t emits Q tokens, one per
RVQ level, so position `p` belongs to level `p % Q`. The sampler enforces
that constraint by masking logits to the valid codebook range for the
current level, so the model cannot emit a level-2 token where a level-0
token is due.

`TokenLM` is the model contract. `ReferenceTokenLM` is a deterministic
stand-in: a conditioning projection plus a temporal-continuity prior (codes
drift slowly from frame to frame, as real music tokens do). A trained
decoder-only transformer with KV-cache replaces it in production.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Protocol

import numpy as np

from musicengine.config import SamplingConfig
from musicengine.conditioning import SectionPlan

PAD, BOS, EOS = 0, 1, 2
SECTION_BASE = 3
MAX_SECTIONS = 16


@dataclass(frozen=True)
class Vocabulary:
    n_codebooks: int
    codebook_size: int

    @property
    def acoustic_base(self) -> int:
        return SECTION_BASE + MAX_SECTIONS

    @property
    def size(self) -> int:
        return self.acoustic_base + self.n_codebooks * self.codebook_size

    def section_token(self, index: int) -> int:
        return SECTION_BASE + (index % MAX_SECTIONS)

    def acoustic_token(self, level: int, code: int) -> int:
        return self.acoustic_base + level * self.codebook_size + code

    def level_range(self, level: int) -> tuple[int, int]:
        lo = self.acoustic_base + level * self.codebook_size
        return lo, lo + self.codebook_size

    def to_code(self, token: int) -> tuple[int, int]:
        """Acoustic token id -> (level, code)."""
        rel = token - self.acoustic_base
        if not 0 <= rel < self.n_codebooks * self.codebook_size:
            raise ValueError(f"token {token} is not an acoustic token")
        return rel // self.codebook_size, rel % self.codebook_size


class TokenLM(Protocol):
    vocab_size: int

    def next_logits(self, history: np.ndarray, conditioning: np.ndarray) -> np.ndarray:
        """Return unnormalised logits (vocab_size,) for the token after `history`."""
        ...


class ReferenceTokenLM:
    def __init__(self, vocab: Vocabulary, cond_dim: int, seed: int = 0, continuity: float = 6.0) -> None:
        self.vocab = vocab
        self.vocab_size = vocab.size
        self.continuity = continuity
        rng = np.random.default_rng(seed)
        self._w_cond = (rng.standard_normal((cond_dim, vocab.size)) * 0.5 / np.sqrt(cond_dim)).astype(np.float32)
        self._prior = rng.standard_normal(vocab.size).astype(np.float32) * 0.1

    def next_logits(self, history: np.ndarray, conditioning: np.ndarray) -> np.ndarray:
        logits = self._prior + conditioning @ self._w_cond
        n_q = self.vocab.n_codebooks
        pos = len(history)  # next token's position in the interleaved stream
        if pos >= n_q:
            level = pos % n_q
            prev = int(history[pos - n_q])
            if self.vocab.acoustic_base <= prev < self.vocab.size:
                _, prev_code = self.vocab.to_code(prev)
                lo, hi = self.vocab.level_range(level)
                codes = np.arange(hi - lo)
                logits[lo:hi] += -self.continuity * np.abs(codes - prev_code) / self.vocab.codebook_size
        return logits


def sample_token(
    logits: np.ndarray,
    allowed: tuple[int, int],
    history: np.ndarray,
    cfg: SamplingConfig,
    rng: np.random.Generator,
) -> int:
    lo, hi = allowed
    scores = logits[lo:hi].astype(np.float64).copy()

    # Repetition penalty on codes already used at this level (recent window).
    recent = history[-64:]
    used = recent[(recent >= lo) & (recent < hi)] - lo
    if used.size and cfg.repetition_penalty != 1.0:
        for c in np.unique(used):
            scores[c] = scores[c] / cfg.repetition_penalty if scores[c] > 0 else scores[c] * cfg.repetition_penalty

    scores = scores / max(cfg.temperature, 1e-4)
    if 0 < cfg.top_k < scores.size:
        cutoff = np.partition(scores, -cfg.top_k)[-cfg.top_k]
        scores = np.where(scores >= cutoff, scores, -np.inf)

    probs = np.exp(scores - np.max(scores))
    probs /= probs.sum()
    if cfg.top_p < 1.0:
        order = np.argsort(-probs)
        cum = np.cumsum(probs[order])
        keep = order[: np.searchsorted(cum, cfg.top_p) + 1]
        mask = np.zeros_like(probs)
        mask[keep] = 1.0
        probs = probs * mask
        probs /= probs.sum()
    return lo + int(rng.choice(probs.size, p=probs))


@dataclass(frozen=True)
class TokenChunk:
    frame_start: int
    frame_count: int
    section: str | None
    tokens: np.ndarray  # flattened acoustic token ids, length frame_count * Q


class AutoregressiveEngine:
    def __init__(self, lm: TokenLM, vocab: Vocabulary, sampling: SamplingConfig) -> None:
        self.lm = lm
        self.vocab = vocab
        self.sampling = sampling

    def generate(
        self,
        conditioning: np.ndarray,
        sections: tuple[SectionPlan, ...],
        seed: int,
    ) -> Iterator[TokenChunk]:
        """Yield TokenChunks as they are sampled (streaming)."""
        rng = np.random.default_rng(seed)
        n_q = self.vocab.n_codebooks
        total_frames = sum(s.frames for s in sections)
        # Preallocated history buffer: avoids an O(n) copy per sampled token.
        capacity = 2 + len(sections) + total_frames * n_q
        buf = np.zeros(capacity, dtype=np.int64)
        buf[0] = BOS
        length = 1
        frame_index = 0
        chunk_frames: list[int] = []
        chunk_section: str | None = None
        chunk_start = 0
        step = self.sampling.frames_per_chunk

        def flush() -> TokenChunk:
            nonlocal chunk_frames
            toks = np.array(chunk_frames, dtype=np.int32)
            out = TokenChunk(chunk_start, len(toks) // n_q, chunk_section, toks)
            chunk_frames = []
            return out

        for s_idx, section in enumerate(sections):
            buf[length] = self.vocab.section_token(s_idx)
            length += 1
            # A section boundary forces a flush so chunks never span sections.
            if chunk_frames:
                yield flush()
            chunk_section = section.name
            chunk_start = frame_index
            for _ in range(section.frames):
                logits = self.lm.next_logits(buf[:length], conditioning)
                for level in range(n_q):
                    tok = sample_token(logits, self.vocab.level_range(level), buf[:length], self.sampling, rng)
                    buf[length] = tok
                    length += 1
                    chunk_frames.append(tok)
                    if level + 1 < n_q:
                        logits = self.lm.next_logits(buf[:length], conditioning)
                frame_index += 1
                if len(chunk_frames) // n_q >= step:
                    yield flush()
                    chunk_start = frame_index
            if chunk_frames:
                yield flush()

    def generate_codes(self, conditioning: np.ndarray, sections: tuple[SectionPlan, ...], seed: int) -> np.ndarray:
        """Non-streaming convenience: returns codes of shape (frames, Q)."""
        parts = [c.tokens for c in self.generate(conditioning, sections, seed)]
        flat = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int32)
        codes = np.zeros((len(flat) // self.vocab.n_codebooks, self.vocab.n_codebooks), dtype=np.int32)
        for i, tok in enumerate(flat):
            level, code = self.vocab.to_code(int(tok))
            codes[i // self.vocab.n_codebooks, level] = code
        return codes
