"""Tests for quality filters, metadata cleaning, ingestion policy, privacy and post-training."""

import json
from datetime import datetime, timezone

import numpy as np
import pytest

from musicengine.audio_io import decode_wav, encode_wav
from musicengine.data.ingest import process_record, run_ingest
from musicengine.data.metadata import clean_metadata, estimate_tempo, normalize_key
from musicengine.data.policy import IngestPolicy, SourceRecord, SourceTier
from musicengine.data.quality import QualityThresholds, assess_audio
from musicengine.posttrain import build_preference_pairs, score_generations
from musicengine.privacy import (
    Pseudonymizer,
    PrivacyViolation,
    anonymize_feedback,
    assert_no_pii,
    scrub_text,
)

SR = 44100
KEY = b"k" * 32


def _music_like(seconds: float, seed: int = 0) -> np.ndarray:
    """Time-varying tones plus hi-hat-like bursts: passes SNR and bandwidth checks."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    x = np.zeros(n)
    step = int(0.25 * SR)
    tt = np.arange(step) / SR
    for start in range(0, n - step, step):
        f = rng.uniform(100, 3000)
        x[start:start + step] += 0.3 * np.exp(-tt * 6) * np.sin(2 * np.pi * f * tt)
    burst = int(0.02 * SR)
    for start in range(0, n - burst, int(0.125 * SR)):
        env = np.exp(-np.arange(burst) / (0.004 * SR))
        x[start:start + burst] += 0.05 * env * rng.standard_normal(burst)
    return np.stack([x, x]).astype(np.float32)


# ------------------------------------------------------------------ quality
def test_good_music_passes_quality_gate():
    report = assess_audio(_music_like(15), SR)
    assert report.passed, report.reasons


def test_white_noise_is_rejected_for_low_snr():
    noise = (np.random.default_rng(0).standard_normal((2, 15 * SR)) * 0.1).astype(np.float32)
    assert "low_snr" in assess_audio(noise, SR).reasons


def test_band_limited_audio_is_rejected_for_bandwidth():
    t = np.arange(15 * SR) / SR
    band = (0.3 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)
    report = assess_audio(np.stack([band, band]), SR)
    assert "low_bandwidth" in report.reasons


def test_corrupt_and_degenerate_inputs():
    bad = _music_like(12)
    bad[0, 100] = np.nan
    assert assess_audio(bad, SR).reasons == ("corrupt_samples",)
    assert assess_audio(np.zeros((2, 0), dtype=np.float32), SR).reasons == ("empty_or_malformed",)
    short = _music_like(3)
    assert "too_short" in assess_audio(short, SR).reasons
    clipped = np.clip(_music_like(12) * 10, -1, 1)
    assert "clipped" in assess_audio(clipped, SR).reasons


def test_quiet_audio_is_rejected():
    quiet = _music_like(12) * 0.001
    assert "too_quiet" in assess_audio(quiet, SR, QualityThresholds(min_rms_dbfs=-40)).reasons


# ----------------------------------------------------------------- metadata
def test_tempo_estimator_recovers_click_track():
    rng = np.random.default_rng(0)
    clk = np.zeros(20 * SR)
    burst = int(0.01 * SR)
    for beat in np.arange(0, 20, 0.5):  # 120 BPM
        s = int(beat * SR)
        clk[s:s + burst] = rng.standard_normal(burst) * 0.5 * np.exp(-np.arange(burst) / (0.002 * SR))
    est = estimate_tempo(clk, SR)
    assert est is not None and abs(est - 120) < 3


def test_tempo_octave_error_is_not_flagged():
    rng = np.random.default_rng(0)
    clk = np.zeros(20 * SR)
    burst = int(0.01 * SR)
    for beat in np.arange(0, 20, 0.5):
        s = int(beat * SR)
        clk[s:s + burst] = rng.standard_normal(burst) * 0.5 * np.exp(-np.arange(burst) / (0.002 * SR))
    meta = clean_metadata({"tempo_bpm": 60}, duration_s=20, mono=clk, sample_rate=SR)
    assert "tempo_mismatch" not in meta.flags
    meta = clean_metadata({"tempo_bpm": 90}, duration_s=20, mono=clk, sample_rate=SR)
    assert "tempo_mismatch" in meta.flags


def test_metadata_normalisation_and_flags():
    meta = clean_metadata(
        {
            "genres": ["Hip Hop", "EDM", "polka-fusion", "hip-hop"],
            "key": "am",
            "tempo_bpm": 400,
            "lyrics": "[Verse]\n" + " ".join(["word"] * 200),
        },
        duration_s=20,
    )
    assert meta.genres == ["hip-hop", "electronic"]
    assert "unknown_genre:polka-fusion" in meta.flags
    assert meta.key == "Am"
    assert "tempo_out_of_range" in meta.flags
    assert "lyrics_duration_mismatch" in meta.flags
    assert meta.instrumental is False


def test_instrumental_detected_without_lyrics():
    meta = clean_metadata({"lyrics": None}, duration_s=30)
    assert meta.instrumental is True and meta.lyric_sections == []


@pytest.mark.parametrize("raw,expected", [("C#", "C#"), ("bb", "Bb"), ("Dm", "Dm"), ("H", None)])
def test_key_normalisation(raw, expected):
    flags: list[str] = []
    assert normalize_key(raw, flags) == expected


# ------------------------------------------------------------- policy/ingest
def _rec(**kw) -> SourceRecord:
    base = dict(track_id="t", audio_path="/none", tier=SourceTier.OPEN_WEB, license="cc-by-4.0",
                source_url="https://example.org/a", robots_allowed=True)
    base.update(kw)
    return SourceRecord(**base)


def test_open_web_policy_rules():
    p = IngestPolicy()
    assert p.check(_rec()) == []
    assert p.check(_rec(robots_allowed=None)) == ["robots_unchecked"]
    assert p.check(_rec(robots_allowed=False)) == ["robots_disallowed"]
    assert p.check(_rec(license="cc-by-nc-4.0")) == ["license_not_permitted"]
    assert p.check(_rec(paywalled=True)) == ["access_restricted"]
    assert p.check(_rec(access_restricted=True)) == ["access_restricted"]


def test_licensed_tier_requires_enablement_and_contract():
    rec = _rec(tier=SourceTier.LICENSED, contract_id="C-100", robots_allowed=None,
               source_url=None, license="proprietary")
    assert IngestPolicy().check(rec) == ["licensed_tier_not_enabled"]
    enabled = IngestPolicy(licensed_contracts=frozenset({"C-100"}), allow_licensed=True)
    assert enabled.check(rec) == []
    assert enabled.check(_rec(tier=SourceTier.LICENSED, contract_id="C-999", license="x")) == ["no_active_contract"]


def test_ingest_run_end_to_end(tmp_path):
    good = tmp_path / "good.wav"
    good.write_bytes(encode_wav(_music_like(12), SR))
    short = tmp_path / "short.wav"
    short.write_bytes(encode_wav(_music_like(2), SR))
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"not a wav file")
    rows = [
        {"track_id": "good", "audio_path": str(good), "tier": "open_web", "license": "CC-BY-4.0",
         "source_url": "https://example.org/good", "robots_allowed": True,
         "metadata": {"genres": ["Jazz"], "key": "Bb", "tempo_bpm": 96}},
        {"track_id": "short", "audio_path": str(short), "tier": "open_web", "license": "cc0-1.0",
         "source_url": "https://example.org/s", "robots_allowed": True},
        {"track_id": "junk", "audio_path": str(junk), "tier": "open_web", "license": "cc0-1.0",
         "source_url": "https://example.org/j", "robots_allowed": True},
        {"track_id": "paywalled", "audio_path": str(good), "tier": "open_web", "license": "cc0-1.0",
         "source_url": "https://example.org/p", "robots_allowed": True, "paywalled": True},
    ]
    manifest = [json.dumps(r) for r in rows]
    summary = run_ingest(manifest, tmp_path / "out", IngestPolicy())

    assert summary.seen == 4 and summary.accepted == 1 and summary.rejected == 3
    assert summary.reasons["too_short"] == 1
    assert summary.reasons["corrupt_or_unsupported_format"] == 1
    assert summary.reasons["access_restricted"] == 1

    accepted = [json.loads(l) for l in (tmp_path / "out" / "accepted.jsonl").read_text().splitlines()]
    assert accepted[0]["track_id"] == "good"
    assert accepted[0]["metadata"]["genres"] == ["jazz"]
    assert accepted[0]["metadata"]["key"] == "Bb"
    rejected = [json.loads(l) for l in (tmp_path / "out" / "rejected.jsonl").read_text().splitlines()]
    assert {r["track_id"] for r in rejected} == {"short", "junk", "paywalled"}


def test_process_record_policy_short_circuits_before_audio_load():
    calls = []

    def loader(path):
        calls.append(path)
        raise AssertionError("must not load disallowed audio")

    rec = _rec(robots_allowed=False)
    accepted, reasons, _ = process_record(rec, IngestPolicy(), QualityThresholds(), loader)
    assert accepted is None and reasons == ["robots_disallowed"] and calls == []


def test_wav_roundtrip():
    audio = _music_like(1)
    decoded, sr = decode_wav(encode_wav(audio, SR))
    assert sr == SR and decoded.shape == audio.shape
    assert np.max(np.abs(decoded - np.clip(audio, -1, 1))) < 1e-4


# ----------------------------------------------------------------- privacy
PSEUDO = Pseudonymizer(key=KEY, epoch="2026-Q4")


def test_scrub_text_removes_identifiers_but_keeps_music_terms():
    text = ("send demo to jane.doe@example.com or +1 (415) 555-0199, see https://x.io/a "
            "from 10.0.0.7, cc 4111 1111 1111 1111 @jane_d lyrics about rain")
    out = scrub_text(text)
    for token in ("[EMAIL]", "[PHONE]", "[URL]", "[IP]", "[NUMBER]", "[HANDLE]"):
        assert token in out
    assert "rain" in out and "lyrics" in out


def _feedback(**kw):
    base = dict(job_id="job-1", user_id="user-42", kind="rating", value=4.0,
                occurred_at=datetime(2026, 11, 2, 15, 30, tzinfo=timezone.utc))
    base.update(kw)
    return base


def test_anonymised_row_has_no_identifiers_and_is_allowlisted():
    generation = {"job_id": "job-1", "request": {
        "prompt": "upbeat song, mail me at a@b.co", "genres": ["pop"], "moods": ["happy"],
        "tempo_bpm": 120, "key": "C", "lyrics": "call 555-123-4567 tonight",
        "instrumental": False, "duration_seconds": 30.0}}
    row = anonymize_feedback(_feedback(), generation, PSEUDO)
    assert "user-42" not in json.dumps(row)
    assert "user_id" not in row
    assert "[EMAIL]" in row["prompt_scrubbed"]
    assert "[PHONE]" in row["lyrics_scrubbed"]
    assert row["day"] == "2026-11-02"
    assert_no_pii(row)


def test_pseudonyms_are_stable_within_epoch_and_rotate_across_epochs():
    a = PSEUDO.pseudonym("user", "user-42")
    assert a == PSEUDO.pseudonym("user", "user-42")
    assert a != Pseudonymizer(key=KEY, epoch="2027-Q1").pseudonym("user", "user-42")
    assert a != Pseudonymizer(key=b"z" * 32, epoch="2026-Q4").pseudonym("user", "user-42")


def test_short_pseudonym_key_is_refused():
    with pytest.raises(ValueError):
        Pseudonymizer(key=b"short", epoch="e")


def test_assert_no_pii_blocks_leaks():
    with pytest.raises(PrivacyViolation):
        assert_no_pii({"kind": "rating", "user_id": "u"})
    with pytest.raises(PrivacyViolation):
        assert_no_pii({"kind": "rating", "unexpected_column": 1})
    with pytest.raises(PrivacyViolation):
        assert_no_pii({"prompt_scrubbed": "reach me at a@b.co"})


# --------------------------------------------------------------- post-train
def _row(gen, kind, value=None, prompt="p1"):
    return {"generation_pseudonym": gen, "prompt_hash": prompt, "kind": kind, "value": value}


def test_scores_fold_explicit_and_implicit_signals():
    rows = [
        _row("g1", "rating", 5),
        _row("g1", "completion", 1.0),
        _row("g1", "extend"),
        _row("g2", "rating", 2),
        _row("g2", "edit"),
        _row("g3", "completion", 0.2),  # no rating: neutral base 3
    ]
    scores = {s.generation_pseudonym: s.score for s in score_generations(rows)}
    assert scores["g1"] == pytest.approx(5 + 1.0 + 0.5)
    assert scores["g2"] == pytest.approx(2 - 0.5)
    assert scores["g3"] == pytest.approx(3 + 0.2)


def test_preference_pairs_require_meaningful_gap_and_same_prompt():
    rows = [
        _row("best", "rating", 5, prompt="A"),
        _row("worst", "rating", 1, prompt="A"),
        _row("close1", "rating", 4, prompt="B"),
        _row("close2", "rating", 4, prompt="B"),
        _row("lonely", "rating", 5, prompt="C"),
    ]
    pairs = build_preference_pairs(score_generations(rows))
    assert len(pairs) == 1
    assert pairs[0]["chosen"] == "best" and pairs[0]["rejected"] == "worst"
