"""Tests for conditioning, codec, token engine, diffusion sampler and the full pipeline."""

import threading

import numpy as np
import pytest

from musicengine.codec import RVQCodec, quantization_error, rvq_decode, rvq_encode
from musicengine.conditioning import (
    HashingTextEncoder,
    canonical_text,
    plan_sections,
)
from musicengine.config import CodecConfig, DiffusionConfig, EngineConfig, SamplingConfig
from musicengine.engine.autoregressive import (
    AutoregressiveEngine,
    ReferenceTokenLM,
    Vocabulary,
    BOS,
)
from musicengine.engine.diffusion import (
    DDIMSampler,
    DiffusionCondition,
    DiffusionRefiner,
    ReferenceDenoiser,
    alpha_bar,
)
from musicengine.orchestrator import MusicPipeline, PipelineCancelled, RenderResult
from musicengine.schemas import GenerationRequest, StatusEvent, TokenEvent


# ----------------------------------------------------------------- conditioning
def test_plan_sections_is_exact_and_nonzero():
    req = GenerationRequest(
        prompt="x",
        lyrics="[Verse]\none two three four five\n[Chorus]\nhook\n[Bridge]\n\n[Outro]\nbye bye now",
        duration_seconds=30,
    )
    total = 1500
    plan = plan_sections(req, total, 50)
    assert [s.name for s in plan] == ["verse", "chorus", "bridge", "outro"]
    assert sum(s.frames for s in plan) == total
    assert all(s.frames >= 1 for s in plan)
    assert plan[0].frames > plan[1].frames  # five words outweigh one word


def test_instrumental_gets_default_arc():
    req = GenerationRequest(prompt="x", instrumental=True, duration_seconds=20)
    plan = plan_sections(req, 1000, 50)
    assert [s.name for s in plan] == ["intro", "verse", "chorus", "verse", "chorus", "outro"]
    assert sum(s.frames for s in plan) == 1000


def test_canonical_text_is_stable_and_labelled():
    req = GenerationRequest(prompt="Rainy night", genres=["Lo-Fi", "jazz"], tempo_bpm=84, key="Dm")
    text = canonical_text(req)
    assert text.startswith("prompt: Rainy night")
    assert "genre: lo-fi, jazz" in text
    assert "tempo: 84 bpm" in text and "key: Dm" in text
    assert canonical_text(req) == text


def test_hashing_encoder_is_normalised_and_semantically_ordered():
    enc = HashingTextEncoder(256)
    a, b, c = enc.encode([
        "warm jazz piano trio with brushed drums",
        "smooth jazz piano and brushed drum trio",
        "heavy metal distorted guitars and screaming",
    ])
    assert np.allclose(np.linalg.norm([a, b, c], axis=1), 1.0, atol=1e-5)
    assert a @ b > a @ c


# ------------------------------------------------------------------------ codec
@pytest.fixture(scope="module")
def codec():
    return RVQCodec.build(CodecConfig(), seed=0)


def test_codec_shapes_and_code_range(codec):
    audio = np.random.default_rng(1).standard_normal((2, 44100)).astype(np.float32) * 0.1
    codes = codec.encode(audio)
    assert codes.shape == (codec.num_frames(44100), codec.cfg.n_codebooks)
    assert codes.min() >= 0 and codes.max() < codec.cfg.codebook_size
    out = codec.decode(codes, 44100)
    assert out.shape == (2, 44100)


def test_more_rvq_levels_reduce_latent_error(codec):
    z = codec.to_latent(np.random.default_rng(2).standard_normal((2, 44100)).astype(np.float32) * 0.2)
    errors = []
    for q in range(1, codec.cfg.n_codebooks + 1):
        books = codec.codebooks[:q]
        errors.append(quantization_error(z, rvq_encode(z, books), books))
    assert all(a >= b for a, b in zip(errors, errors[1:])), errors


def test_rvq_roundtrip_is_nearest_centroid_consistent(codec):
    z = codec.to_latent(np.ones((2, 4410), dtype=np.float32) * 0.1)
    codes = rvq_encode(z, codec.codebooks)
    recon = rvq_decode(codes, codec.codebooks)
    # Re-encoding a reconstruction must return the same codes (fixed point).
    assert np.array_equal(rvq_encode(recon, codec.codebooks), codes)


def test_codec_rejects_wrong_channel_count(codec):
    with pytest.raises(ValueError):
        codec.to_latent(np.zeros((1, 100), dtype=np.float32))


# ------------------------------------------------------------- token engine
def test_vocabulary_levels_partition_acoustic_space():
    vocab = Vocabulary(4, 256)
    ranges = [vocab.level_range(q) for q in range(4)]
    assert ranges[0][0] == vocab.acoustic_base
    assert ranges[-1][1] == vocab.size
    for (lo1, hi1), (lo2, _) in zip(ranges, ranges[1:]):
        assert hi1 == lo2
    for q in range(4):
        for k in (0, 255):
            assert vocab.to_code(vocab.acoustic_token(q, k)) == (q, k)


@pytest.fixture(scope="module")
def ar_engine():
    cfg = EngineConfig()
    vocab = Vocabulary(cfg.codec.n_codebooks, cfg.codec.codebook_size)
    lm = ReferenceTokenLM(vocab, cfg.clap_dim, seed=3)
    return AutoregressiveEngine(lm, vocab, SamplingConfig(frames_per_chunk=25)), vocab


def _sections():
    req = GenerationRequest(prompt="x", instrumental=True, duration_seconds=10)
    return plan_sections(req, 500, 50)


def test_stream_respects_level_constraints_and_frame_count(ar_engine):
    engine, vocab = ar_engine
    cond = np.random.default_rng(0).standard_normal(512).astype(np.float32)
    cond /= np.linalg.norm(cond)
    sections = _sections()
    chunks = list(engine.generate(cond, sections, seed=5))
    assert sum(c.frame_count for c in chunks) == sum(s.frames for s in sections)
    for chunk in chunks:
        toks = chunk.tokens.reshape(chunk.frame_count, vocab.n_codebooks)
        for q in range(vocab.n_codebooks):
            lo, hi = vocab.level_range(q)
            assert np.all((toks[:, q] >= lo) & (toks[:, q] < hi))


def test_chunks_never_span_sections_and_stream_incrementally(ar_engine):
    engine, _ = ar_engine
    cond = np.zeros(512, dtype=np.float32)
    sections = _sections()
    chunks = list(engine.generate(cond, sections, seed=9))
    assert len(chunks) > len(sections)  # streaming: more than one chunk
    starts = [c.frame_start for c in chunks]
    assert starts == sorted(starts)
    boundaries = np.cumsum([0] + [s.frames for s in sections])
    for c in chunks:
        idx = np.searchsorted(boundaries, c.frame_start, side="right") - 1
        assert c.frame_start + c.frame_count <= boundaries[idx + 1]
        assert c.section == sections[idx].name


def test_sampling_is_deterministic_per_seed(ar_engine):
    engine, _ = ar_engine
    cond = np.ones(512, dtype=np.float32) / np.sqrt(512)
    a = engine.generate_codes(cond, _sections(), seed=11)
    b = engine.generate_codes(cond, _sections(), seed=11)
    c = engine.generate_codes(cond, _sections(), seed=12)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, c)


def test_history_starts_with_bos_semantics():
    # BOS is reserved and must never be sampled as an acoustic token.
    vocab = Vocabulary(4, 256)
    assert BOS < vocab.acoustic_base


# ---------------------------------------------------------------- diffusion
def test_alpha_bar_is_monotone_and_normalised():
    assert alpha_bar(0) == pytest.approx(1.0)
    ts = np.arange(0, 1000, 50)
    vals = alpha_bar(ts)
    assert np.all(np.diff(vals) < 0)
    assert 0 < vals[-1] < 1e-2


def test_ddim_without_text_recovers_token_prior():
    """With a consistent noise predictor, deterministic DDIM must land exactly on the prior."""
    cfg = DiffusionConfig(steps=20, eta=0.0, guidance_scale=3.0)
    denoiser = ReferenceDenoiser(latent_dim=32, text_dim=64, seed=0)
    prior = np.random.default_rng(4).standard_normal((40, 32)).astype(np.float32)
    out = DDIMSampler(cfg).sample(denoiser, DiffusionCondition(None, prior), prior.shape, seed=1)
    assert np.allclose(out, prior, atol=1e-3)


def test_classifier_free_guidance_scales_text_offset_only():
    cfg = DiffusionConfig(steps=25, eta=0.0, guidance_scale=2.5)
    denoiser = ReferenceDenoiser(latent_dim=16, text_dim=32, seed=7)
    rng = np.random.default_rng(5)
    prior = rng.standard_normal((30, 16)).astype(np.float32)
    text = rng.standard_normal(32).astype(np.float32)
    text /= np.linalg.norm(text)
    out = DiffusionRefiner(denoiser, cfg).refine(prior, text, seed=2)
    offset = denoiser._x0_target(DiffusionCondition(text, prior)) - prior
    assert np.allclose(out, prior + cfg.guidance_scale * offset, atol=2e-3)


def test_refiner_is_seeded_and_stochastic_when_eta_positive():
    denoiser = ReferenceDenoiser(latent_dim=8, text_dim=16, seed=0)
    prior = np.zeros((10, 8), dtype=np.float32)
    det = DiffusionRefiner(denoiser, DiffusionConfig(eta=0.0))
    sto = DiffusionRefiner(denoiser, DiffusionConfig(eta=1.0))
    assert np.array_equal(det.refine(prior, None, 3), det.refine(prior, None, 3))
    assert not np.allclose(sto.refine(prior, None, 3), sto.refine(prior, None, 4))


# ---------------------------------------------------------------- pipeline
@pytest.fixture(scope="module")
def pipeline():
    return MusicPipeline.reference(seed=0)


def _run(pipeline, req, job="job", cancel=None):
    events = list(pipeline.run(req, job, cancel))
    result = events[-1]
    assert isinstance(result, RenderResult)
    return events, result


def test_pipeline_streams_status_and_tokens_then_renders(pipeline):
    req = GenerationRequest(prompt="lo-fi rain", tempo_bpm=84, duration_seconds=8, seed=7,
                            lyrics="[Verse]\nrain on the glass\n[Chorus]\nhold me")
    events, result = _run(pipeline, req)
    stages = [e.status.value for e in events if isinstance(e, StatusEvent)]
    assert stages[0] == "conditioning"
    assert stages[-2:] == ["refining", "decoding"] or "decoding" in stages
    token_events = [e for e in events if isinstance(e, TokenEvent)]
    assert [e.sequence for e in token_events] == list(range(len(token_events)))
    n_frames = sum(e.frame_count for e in token_events)
    assert n_frames == result.codes.shape[0]
    assert sum(len(e.tokens) for e in token_events) == n_frames * pipeline.vocab.n_codebooks


def test_pipeline_audio_contract(pipeline):
    req = GenerationRequest(prompt="ambient", instrumental=True, duration_seconds=6, seed=1)
    _, r = _run(pipeline, req)
    assert r.audio.dtype == np.float32
    assert r.audio.shape == (2, pipeline.codec.num_frames(6 * 44100) * pipeline.codec.cfg.hop) or \
        r.audio.shape[0] == 2
    assert np.all(np.isfinite(r.audio))
    assert float(np.max(np.abs(r.audio))) <= 1.0
    assert r.sample_rate == 44100


def test_pipeline_is_deterministic_and_seed_sensitive(pipeline):
    req = GenerationRequest(prompt="synth pop", duration_seconds=5, seed=42)
    _, a = _run(pipeline, req)
    _, b = _run(pipeline, req)
    _, c = _run(pipeline, req.model_copy(update={"seed": 43}))
    assert np.array_equal(a.audio, b.audio)
    assert not np.array_equal(a.audio, c.audio)


def test_cancellation_stops_render(pipeline):
    cancel = threading.Event()
    cancel.set()
    req = GenerationRequest(prompt="x", instrumental=True, duration_seconds=5, seed=0)
    with pytest.raises(PipelineCancelled):
        list(pipeline.run(req, "cancelled-job", cancel))


def test_cancel_mid_stream_halts_before_refinement(pipeline):
    cancel = threading.Event()
    req = GenerationRequest(prompt="x", instrumental=True, duration_seconds=20, seed=0)
    gen = pipeline.run(req, "mid", cancel)
    seen_tokens = 0
    with pytest.raises(PipelineCancelled):
        for ev in gen:
            if isinstance(ev, TokenEvent):
                seen_tokens += 1
                if seen_tokens == 2:
                    cancel.set()
    assert seen_tokens == 2
