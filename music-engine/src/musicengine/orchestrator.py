"""Inference orchestration: prompt -> conditioning -> AR tokens -> diffusion refine -> waveform.

The pipeline is a synchronous generator. It yields `StatusEvent`s and
`TokenEvent`s as work progresses, and finishes by yielding one
`RenderResult`. Callers that live on an event loop (the API layer) drive it
with `asyncio.to_thread(next, gen)` so CPU-bound stages never block the loop.

Cancellation is cooperative: a `threading.Event` is checked between
streamed chunks and between stages, so a cancelled job stops within one
chunk (~0.5 s of audio worth of tokens) rather than at the end.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Iterator, Union

import numpy as np

from musicengine.codec import RVQCodec
from musicengine.conditioning import ConditioningService, TextEncoder, HashingTextEncoder
from musicengine.config import EngineConfig
from musicengine.engine.autoregressive import AutoregressiveEngine, ReferenceTokenLM, Vocabulary
from musicengine.engine.diffusion import DiffusionRefiner, ReferenceDenoiser
from musicengine.schemas import GenerationRequest, GenerationStatus, StatusEvent, TokenEvent

PEAK_TARGET = 10 ** (-1.0 / 20.0)  # -1 dBFS


class PipelineCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class RenderResult:
    audio: np.ndarray            # (C, T) float32 in [-1, 1]
    sample_rate: int
    codes: np.ndarray            # (N, Q) int32 RVQ codes that drove the render
    seed: int
    timings_ms: dict[str, float] = field(default_factory=dict)


PipelineEvent = Union[StatusEvent, TokenEvent, RenderResult]


class MusicPipeline:
    def __init__(
        self,
        cfg: EngineConfig,
        conditioning: ConditioningService,
        ar: AutoregressiveEngine,
        codec: RVQCodec,
        refiner: DiffusionRefiner,
    ) -> None:
        self.cfg = cfg
        self.conditioning = conditioning
        self.ar = ar
        self.codec = codec
        self.refiner = refiner
        self.vocab = ar.vocab

    @classmethod
    def reference(cls, cfg: EngineConfig | None = None, seed: int = 0) -> "MusicPipeline":
        """Wire up the dependency-free reference backends."""
        cfg = cfg or EngineConfig()
        encoder: TextEncoder = HashingTextEncoder(cfg.clap_dim)
        codec = RVQCodec.build(cfg.codec, seed=seed)
        vocab = Vocabulary(cfg.codec.n_codebooks, cfg.codec.codebook_size)
        lm = ReferenceTokenLM(vocab, cfg.clap_dim, seed=seed)
        denoiser = ReferenceDenoiser(cfg.codec.latent_dim, cfg.clap_dim, seed=seed)
        return cls(
            cfg,
            ConditioningService(encoder, cfg.codec),
            AutoregressiveEngine(lm, vocab, cfg.sampling),
            codec,
            DiffusionRefiner(denoiser, cfg.diffusion),
        )

    def run(
        self,
        request: GenerationRequest,
        job_id: str,
        cancel: threading.Event | None = None,
    ) -> Iterator[PipelineEvent]:
        cancel = cancel or threading.Event()
        timings: dict[str, float] = {}

        def check() -> None:
            if cancel.is_set():
                raise PipelineCancelled(job_id)

        def status(stage: GenerationStatus, progress: float) -> StatusEvent:
            return StatusEvent(job_id=job_id, status=stage, progress=progress)

        seed = request.seed if request.seed is not None else self.cfg.default_seed
        n_q = self.vocab.n_codebooks

        t0 = time.perf_counter()
        yield status(GenerationStatus.CONDITIONING, 0.02)
        cond = self.conditioning.condition(request)
        timings["conditioning"] = (time.perf_counter() - t0) * 1e3
        check()

        # --- Stage 1: autoregressive token stream (streamed to the client) ---
        t0 = time.perf_counter()
        yield status(GenerationStatus.GENERATING_TOKENS, 0.05)
        code_frames: list[np.ndarray] = []
        frames_done = 0
        sequence = 0
        for chunk in self.ar.generate(cond.text_embedding, cond.sections, seed):
            check()
            codes = np.zeros((chunk.frame_count, n_q), dtype=np.int32)
            for i, tok in enumerate(chunk.tokens):
                level, code = self.vocab.to_code(int(tok))
                codes[i // n_q, level] = code
            code_frames.append(codes)
            yield TokenEvent(
                job_id=job_id,
                sequence=sequence,
                section=chunk.section,
                frame_start=chunk.frame_start,
                frame_count=chunk.frame_count,
                tokens=[int(t) for t in chunk.tokens],
            )
            sequence += 1
            frames_done += chunk.frame_count
            yield status(
                GenerationStatus.GENERATING_TOKENS,
                0.05 + 0.5 * frames_done / cond.total_frames,
            )
        all_codes = np.concatenate(code_frames, axis=0)
        timings["tokens"] = (time.perf_counter() - t0) * 1e3
        check()

        # --- Stage 2: diffusion refinement in codec-latent space ---
        t0 = time.perf_counter()
        yield status(GenerationStatus.REFINING, 0.6)
        prior = self.codec.dequantize(all_codes)
        refined = self.refiner.refine(prior, cond.text_embedding, seed=seed + 1)
        timings["refine"] = (time.perf_counter() - t0) * 1e3
        check()

        # --- Stage 3: neural codec decoder -> stereo waveform ---
        t0 = time.perf_counter()
        yield status(GenerationStatus.DECODING, 0.9)
        num_samples = cond.total_frames * self.codec.cfg.hop
        audio = self.codec.from_latent(refined, num_samples)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0:
            audio = audio * (PEAK_TARGET / peak)
        audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
        timings["decode"] = (time.perf_counter() - t0) * 1e3

        yield RenderResult(
            audio=audio,
            sample_rate=self.codec.cfg.sample_rate,
            codes=all_codes,
            seed=seed,
            timings_ms=timings,
        )
