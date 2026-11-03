"""Neural-codec stand-in: DCT bottleneck + residual vector quantisation (RVQ).

Pipeline (encode):  waveform (C, T)
                    -> hop-sized frames per channel
                    -> per-channel DCT-II, keep the lowest `k` coefficients
                    -> latent z in R^{N x D}   (D = C * k)
                    -> RVQ: Q residual stages, each a K-entry codebook
                    -> integer codes (N, Q)

Decode reverses each step. The quantiser is real (codebooks are fitted with
residual k-means); the transform is a fixed linear DCT, so reconstruction is
band-limited to roughly `k / hop * sample_rate / 2`. A production system
replaces `_dct_basis` with a trained convolutional encoder/decoder (EnCodec
style) and keeps the RVQ and token interfaces unchanged.
"""

from __future__ import annotations

import math

import numpy as np

from musicengine.config import CodecConfig


def _dct_basis(n: int, k: int) -> np.ndarray:
    """Orthonormal DCT-II basis, first `k` columns, shape (n, k)."""
    t = np.arange(n)[:, None]
    f = np.arange(k)[None, :]
    basis = np.cos(np.pi * (t + 0.5) * f / n)
    basis[:, 0] *= math.sqrt(1.0 / n)
    basis[:, 1:] *= math.sqrt(2.0 / n)
    return basis


class RVQCodec:
    def __init__(self, cfg: CodecConfig, codebooks: np.ndarray) -> None:
        """`codebooks` has shape (n_codebooks, codebook_size, latent_dim)."""
        expected = (cfg.n_codebooks, cfg.codebook_size, cfg.latent_dim)
        if codebooks.shape != expected:
            raise ValueError(f"codebooks shape {codebooks.shape} != {expected}")
        self.cfg = cfg
        self.codebooks = codebooks.astype(np.float32)
        k = cfg.latent_dim // cfg.channels
        if k * cfg.channels != cfg.latent_dim:
            raise ValueError("latent_dim must be divisible by channels")
        if k > cfg.hop:
            raise ValueError("latent_dim/channels cannot exceed hop size")
        self._basis = _dct_basis(cfg.hop, k).astype(np.float32)  # (hop, k)

    # ------------------------------------------------------------------ build
    @classmethod
    def build(cls, cfg: CodecConfig, seed: int = 0, fit_frames: int = 4096, iters: int = 8) -> "RVQCodec":
        """Construct a codec and fit its codebooks on synthetic music-like audio.

        Fitting on real audio is done offline by `fit`; this default keeps the
        reference deterministic and dependency-free.
        """
        rng = np.random.default_rng(seed)
        k = cfg.latent_dim // cfg.channels
        basis = _dct_basis(cfg.hop, k).astype(np.float32)
        # Latent frames from random harmonic tones with decaying envelopes.
        n_tones = fit_frames
        freqs = rng.uniform(40.0, 2000.0, size=(n_tones, 1))
        harmonics = np.arange(1, 6)[None, :]
        t = np.arange(cfg.hop)[None, :] / cfg.sample_rate
        frames = np.zeros((n_tones, cfg.hop), dtype=np.float32)
        for h in range(5):
            amp = rng.uniform(0.2, 1.0, size=(n_tones, 1)) / harmonics[0, h]
            frames += (amp * np.sin(2 * np.pi * freqs * harmonics[0, h] * t)).astype(np.float32)
        latents = []
        for _ in range(cfg.channels):
            coeffs = frames @ basis  # (n_tones, k)
            latents.append(coeffs * rng.uniform(0.5, 1.5, size=(n_tones, 1)).astype(np.float32))
        z = np.concatenate(latents, axis=1).astype(np.float32)
        codebooks = fit_rvq(z, cfg.n_codebooks, cfg.codebook_size, iters=iters, seed=seed)
        return cls(cfg, codebooks)

    # ----------------------------------------------------------- transforms
    def num_frames(self, num_samples: int) -> int:
        return int(math.ceil(num_samples / self.cfg.hop))

    def to_latent(self, audio: np.ndarray) -> np.ndarray:
        """(C, T) waveform -> (N, D) latent."""
        if audio.ndim != 2 or audio.shape[0] != self.cfg.channels:
            raise ValueError(f"expected audio of shape ({self.cfg.channels}, T)")
        hop = self.cfg.hop
        n = self.num_frames(audio.shape[1])
        padded = np.zeros((self.cfg.channels, n * hop), dtype=np.float32)
        padded[:, : audio.shape[1]] = audio
        blocks = padded.reshape(self.cfg.channels, n, hop)
        per_channel = [blocks[c] @ self._basis for c in range(self.cfg.channels)]
        return np.concatenate(per_channel, axis=1).astype(np.float32)

    def from_latent(self, z: np.ndarray, num_samples: int) -> np.ndarray:
        """(N, D) latent -> (C, num_samples) waveform."""
        k = self._basis.shape[1]
        n = z.shape[0]
        out = np.zeros((self.cfg.channels, n * self.cfg.hop), dtype=np.float32)
        for c in range(self.cfg.channels):
            coeffs = z[:, c * k:(c + 1) * k]
            out[c] = (coeffs @ self._basis.T).reshape(-1)
        return out[:, :num_samples]

    # ------------------------------------------------------------ quantiser
    def quantize(self, z: np.ndarray) -> np.ndarray:
        """(N, D) latent -> (N, Q) int codes."""
        return rvq_encode(z, self.codebooks)

    def dequantize(self, codes: np.ndarray) -> np.ndarray:
        return rvq_decode(codes, self.codebooks)

    def encode(self, audio: np.ndarray) -> np.ndarray:
        return self.quantize(self.to_latent(audio))

    def decode(self, codes: np.ndarray, num_samples: int) -> np.ndarray:
        return self.from_latent(self.dequantize(codes), num_samples)


def _nearest(x: np.ndarray, centroids: np.ndarray) -> np.ndarray:
    d = (
        np.sum(x * x, axis=1, keepdims=True)
        - 2.0 * x @ centroids.T
        + np.sum(centroids * centroids, axis=1)[None, :]
    )
    return np.argmin(d, axis=1)


def rvq_encode(z: np.ndarray, codebooks: np.ndarray) -> np.ndarray:
    residual = z.astype(np.float32).copy()
    codes = np.zeros((z.shape[0], codebooks.shape[0]), dtype=np.int32)
    for q in range(codebooks.shape[0]):
        idx = _nearest(residual, codebooks[q])
        codes[:, q] = idx
        residual -= codebooks[q][idx]
    return codes


def rvq_decode(codes: np.ndarray, codebooks: np.ndarray) -> np.ndarray:
    out = np.zeros((codes.shape[0], codebooks.shape[2]), dtype=np.float32)
    for q in range(codebooks.shape[0]):
        out += codebooks[q][codes[:, q]]
    return out


def fit_rvq(z: np.ndarray, n_codebooks: int, codebook_size: int, iters: int = 8, seed: int = 0) -> np.ndarray:
    """Residual k-means: each stage is fitted to what the previous stages missed."""
    rng = np.random.default_rng(seed)
    residual = z.astype(np.float32).copy()
    books = np.zeros((n_codebooks, codebook_size, z.shape[1]), dtype=np.float32)
    for q in range(n_codebooks):
        init = rng.choice(residual.shape[0], size=codebook_size, replace=residual.shape[0] < codebook_size)
        centroids = residual[init].copy()
        for _ in range(iters):
            assign = _nearest(residual, centroids)
            for k in range(codebook_size):
                members = residual[assign == k]
                if len(members):
                    centroids[k] = members.mean(axis=0)
        books[q] = centroids
        residual -= centroids[_nearest(residual, centroids)]
    return books


def quantization_error(z: np.ndarray, codes: np.ndarray, codebooks: np.ndarray) -> float:
    """Mean squared error between a latent and its RVQ reconstruction."""
    return float(np.mean((z - rvq_decode(codes, codebooks)) ** 2))
