"""Schema validation and OpenAPI <-> pydantic consistency."""

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from musicengine.schemas import FeedbackEvent, GenerationRequest

OPENAPI = Path(__file__).resolve().parents[1] / "docs" / "api" / "openapi.yaml"


def test_instrumental_with_lyrics_is_rejected():
    with pytest.raises(ValidationError):
        GenerationRequest(prompt="x", instrumental=True, lyrics="la la")


def test_key_pattern_and_tempo_bounds():
    GenerationRequest(prompt="x", key="F#m", tempo_bpm=40)
    with pytest.raises(ValidationError):
        GenerationRequest(prompt="x", key="H")
    with pytest.raises(ValidationError):
        GenerationRequest(prompt="x", tempo_bpm=241)


def test_tags_are_lowercased_and_deduplicated():
    req = GenerationRequest(prompt="x", genres=["Rock", " rock ", "Pop"])
    assert req.genres == ["rock", "pop"]


def test_lyric_sections_split_on_tags():
    req = GenerationRequest(prompt="x", lyrics="[Verse 1]\nline a\n[Chorus]\nline b")
    assert req.lyric_sections() == [("verse 1", "line a"), ("chorus", "line b")]
    untagged = GenerationRequest(prompt="x", lyrics="just words")
    assert untagged.lyric_sections() == [("verse", "just words")]


def test_feedback_value_ranges():
    with pytest.raises(ValidationError):
        FeedbackEvent(job_id="j", user_id="u", kind="rating", value=6)
    with pytest.raises(ValidationError):
        FeedbackEvent(job_id="j", user_id="u", kind="completion", value=1.5)
    FeedbackEvent(job_id="j", user_id="u", kind="edit")


def test_openapi_generation_request_matches_model():
    spec = yaml.safe_load(OPENAPI.read_text(encoding="utf-8"))
    schema = spec["components"]["schemas"]["GenerationRequest"]
    model_fields = set(GenerationRequest.model_fields)
    assert set(schema["properties"]) == model_fields
    assert set(schema.get("required", [])) == {"prompt"}


def test_openapi_feedback_and_token_event_match_models():
    spec = yaml.safe_load(OPENAPI.read_text(encoding="utf-8"))
    comps = spec["components"]["schemas"]
    from musicengine.schemas import FeedbackEvent as FE, TokenEvent as TE
    assert set(comps["FeedbackEvent"]["properties"]) == set(FE.model_fields)
    assert set(comps["TokenEvent"]["properties"]) == set(TE.model_fields)
