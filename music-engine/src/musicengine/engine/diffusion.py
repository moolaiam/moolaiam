"""Conditional latent diffusion refiner (DDIM sampler, classifier-free guidance).

The refiner starts from pure Gaussian noise in codec-latent space and
iteratively denoises toward a clean latent. The denoiser is conditioned on
two signals:
  * `prior_latent`: the dequantised AR token stream (macro structure, melody,
    rhythm), and
  * `text_embedding`: the CLAP-space prompt embedding (timbre, mood, style).

Classifier-free guidance is applied over the text condition only. The
unconditional branch keeps the token prior and drops the text, so guidance
strengthens the prompt's influence without re-weighting the token structure.
For the linear-Gaussian reference denoiser this is exact:
    guided x0 = prior + w * text_offset

`ReferenceDenoiser` is an analytic stand-in for a trained U-Net / DiT. The
sampler, schedule, and guidance arithmetic are the production code paths.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from musicengine.config import DiffusionConfig

TRAIN_STEPS = 1000


@dataclass(frozen=True)
class DiffusionCondition:
    text_embedding: np.ndarray | None  # None = unconditional (text dropped)
    prior_latent: np.ndarray           # (N, D) dequantised token prior


class Denoiser(Protocol):
    def predict_noise(self, x_t: np.ndarray, t: int, cond: DiffusionCondition) -> np.ndarray: ...


def alpha_bar(t: np.ndarray | float, s: float = 0.008) -> np.ndarray:
    """Cosine schedule (Nichol & Dhariwal 2021), normalised so alpha_bar(0) = 1."""
    def f(u: np.ndarray) -> np.ndarray:
        return np.cos((u / TRAIN_STEPS + s) / (1 + s) * math.pi / 2) ** 2

    return f(np.asarray(t, dtype=np.float64)) / f(np.asarray(0.0))


class ReferenceDenoiser:
    """Predicts noise for the x0-target  prior + gamma * tanh(W e_text)."""

    def __init__(self, latent_dim: int, text_dim: int, seed: int = 0, text_gain: float = 0.25) -> None:
        rng = np.random.default_rng(seed)
        self._w_text = (rng.standard_normal((latent_dim, text_dim)) / np.sqrt(text_dim)).astype(np.float32)
        self._gain = text_gain

    def _x0_target(self, cond: DiffusionCondition) -> np.ndarray:
        target = cond.prior_latent.astype(np.float32)
        if cond.text_embedding is not None:
            offset = self._gain * np.tanh(self._w_text @ cond.text_embedding)
            target = target + offset[None, :]
        return target

    def predict_noise(self, x_t: np.ndarray, t: int, cond: DiffusionCondition) -> np.ndarray:
        a = math.sqrt(float(alpha_bar(t)))
        s = math.sqrt(max(1.0 - float(alpha_bar(t)), 1e-12))
        return (x_t - a * self._x0_target(cond)) / s


class DDIMSampler:
    def __init__(self, cfg: DiffusionConfig) -> None:
        self.cfg = cfg

    def timesteps(self) -> np.ndarray:
        ts = np.linspace(TRAIN_STEPS - 1, 0, self.cfg.steps).round().astype(int)
        return np.unique(ts)[::-1]

    def sample(
        self,
        denoiser: Denoiser,
        cond: DiffusionCondition,
        shape: tuple[int, int],
        seed: int,
    ) -> np.ndarray:
        rng = np.random.default_rng(seed)
        uncond = DiffusionCondition(None, cond.prior_latent)
        x = rng.standard_normal(shape).astype(np.float32)
        ts = self.timesteps()
        w = self.cfg.guidance_scale
        for i, t in enumerate(ts):
            ab_t = float(alpha_bar(t))
            ab_prev = float(alpha_bar(ts[i + 1])) if i + 1 < len(ts) else 1.0

            eps_c = denoiser.predict_noise(x, int(t), cond)
            eps = eps_c
            if w != 1.0 and cond.text_embedding is not None:
                eps_u = denoiser.predict_noise(x, int(t), uncond)
                eps = eps_u + w * (eps_c - eps_u)

            x0 = (x - math.sqrt(1 - ab_t) * eps) / math.sqrt(ab_t)
            if self.cfg.eta > 0 and ab_t < 1.0:
                sigma = self.cfg.eta * math.sqrt((1 - ab_prev) / (1 - ab_t)) * math.sqrt(1 - ab_t / ab_prev)
            else:
                sigma = 0.0  # deterministic DDIM; also the t=0 limit where 1 - ab_t = 0
            direction = math.sqrt(max(1 - ab_prev - sigma**2, 0.0)) * eps
            noise = rng.standard_normal(shape).astype(np.float32) if sigma > 0 else 0.0
            x = math.sqrt(ab_prev) * x0 + direction + sigma * noise
        return x.astype(np.float32)


class DiffusionRefiner:
    def __init__(self, denoiser: Denoiser, cfg: DiffusionConfig) -> None:
        self.denoiser = denoiser
        self.sampler = DDIMSampler(cfg)

    def refine(self, prior_latent: np.ndarray, text_embedding: np.ndarray | None, seed: int) -> np.ndarray:
        cond = DiffusionCondition(text_embedding, prior_latent.astype(np.float32))
        return self.sampler.sample(self.denoiser, cond, prior_latent.shape, seed)
