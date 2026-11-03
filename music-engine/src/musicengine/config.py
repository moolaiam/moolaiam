"""Engine configuration. All numeric defaults are for the reference backends."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CodecConfig:
    sample_rate: int = 44_100
    channels: int = 2
    frame_rate_hz: int = 50          # latent frames per second
    latent_dim: int = 256            # = channels * kept DCT coefficients per channel
    n_codebooks: int = 4             # RVQ depth; token budget per frame
    codebook_size: int = 256

    @property
    def hop(self) -> int:
        if self.sample_rate % self.frame_rate_hz:
            raise ValueError("sample_rate must be divisible by frame_rate_hz")
        return self.sample_rate // self.frame_rate_hz


@dataclass(frozen=True)
class SamplingConfig:
    temperature: float = 0.9
    top_k: int = 64
    top_p: float = 0.95
    repetition_penalty: float = 1.05
    frames_per_chunk: int = 25       # 0.5 s of audio per streamed TokenEvent


@dataclass(frozen=True)
class DiffusionConfig:
    steps: int = 20
    eta: float = 0.0                 # 0 = deterministic DDIM
    guidance_scale: float = 3.0      # classifier-free guidance strength
    cosine_s: float = 0.008


@dataclass(frozen=True)
class EngineConfig:
    codec: CodecConfig = field(default_factory=CodecConfig)
    sampling: SamplingConfig = field(default_factory=SamplingConfig)
    diffusion: DiffusionConfig = field(default_factory=DiffusionConfig)
    clap_dim: int = 512
    max_duration_seconds: float = 240.0
    default_seed: int = 0
