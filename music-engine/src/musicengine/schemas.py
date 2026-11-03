"""Public API data models.

These pydantic models are the single source of truth for request/response
validation. `docs/api/openapi.yaml` mirrors them and must be kept in sync
(`tests/test_schemas.py` checks the field names and required sets).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

KEY_PATTERN = r"^[A-G](#|b)?(m)?$"  # e.g. "C", "F#", "Bbm"
SECTION_TAG = re.compile(r"^\s*\[(?P<name>[A-Za-z][A-Za-z0-9 ]{1,23})\]\s*$", re.MULTILINE)


class GenerationStatus(str, Enum):
    QUEUED = "queued"
    CONDITIONING = "conditioning"
    GENERATING_TOKENS = "generating_tokens"
    REFINING = "refining"
    DECODING = "decoding"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset(
    {GenerationStatus.SUCCEEDED, GenerationStatus.FAILED, GenerationStatus.CANCELLED}
)


class GenerationRequest(BaseModel):
    """POST /v1/generations body."""

    prompt: str = Field(
        min_length=1,
        max_length=1000,
        description="Free-form thematic / mood / scene description.",
    )
    genres: list[str] = Field(default_factory=list, max_length=5)
    moods: list[str] = Field(default_factory=list, max_length=5)
    instruments: list[str] = Field(default_factory=list, max_length=12)
    tempo_bpm: int | None = Field(default=None, ge=40, le=240)
    key: str | None = Field(default=None, pattern=KEY_PATTERN)
    lyrics: str | None = Field(default=None, max_length=4000)
    instrumental: bool = False
    duration_seconds: float = Field(default=30.0, ge=5.0, le=240.0)
    seed: int | None = Field(default=None, ge=0, lt=2**32)

    @field_validator("genres", "moods", "instruments")
    @classmethod
    def _normalize_tags(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip().lower() for v in values if v and v.strip()]
        # Preserve order, drop duplicates.
        return list(dict.fromkeys(cleaned))

    @model_validator(mode="after")
    def _lyrics_vs_instrumental(self) -> "GenerationRequest":
        if self.instrumental and self.lyrics:
            raise ValueError("instrumental=true cannot be combined with lyrics")
        return self

    def lyric_sections(self) -> list[tuple[str, str]]:
        """Split lyrics on `[Verse]`, `[Chorus]`, ... tags.

        Returns (section_name, body) pairs. Untagged lyrics become one section
        called "verse".
        """
        if not self.lyrics or self.instrumental:
            return []
        text = self.lyrics
        matches = list(SECTION_TAG.finditer(text))
        if not matches:
            return [("verse", text.strip())]
        sections: list[tuple[str, str]] = []
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            body = text[m.end():end].strip()
            sections.append((m.group("name").strip().lower(), body))
        return sections


class GenerationJob(BaseModel):
    """GET /v1/generations/{id} response."""

    id: str
    status: GenerationStatus
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    request: GenerationRequest
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    error: str | None = None
    audio_url: str | None = None
    tokens_emitted: int = 0


class TokenEvent(BaseModel):
    """One chunk of the server-sent `token` stream (GET .../events).

    `tokens` is the flattened, interleaved acoustic stream: frame-major, with
    `n_codebooks` tokens per frame. Token ids are already offset into the
    engine vocabulary (see `musicengine.engine.autoregressive.Vocabulary`).
    """

    type: Literal["tokens"] = "tokens"
    job_id: str
    sequence: int = Field(ge=0)
    section: str | None = None
    frame_start: int = Field(ge=0)
    frame_count: int = Field(ge=1)
    tokens: list[int]


class StatusEvent(BaseModel):
    type: Literal["status"] = "status"
    job_id: str
    status: GenerationStatus
    progress: float = Field(ge=0.0, le=1.0)
    error: str | None = None


class FeedbackKind(str, Enum):
    RATING = "rating"            # value: 1..5
    COMPLETION = "completion"    # value: fraction listened, 0..1
    EXTEND = "extend"            # user asked to extend a generation
    EDIT = "edit"                # user edited prompt/lyrics and regenerated


class FeedbackEvent(BaseModel):
    """POST /v1/feedback body. Raw records; anonymised before post-training."""

    job_id: str
    user_id: str = Field(description="Internal account id. Never leaves the raw store.")
    kind: FeedbackKind
    value: float | None = None
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def _check_value(self) -> "FeedbackEvent":
        if self.kind == FeedbackKind.RATING:
            if self.value is None or not 1 <= self.value <= 5:
                raise ValueError("rating value must be in [1, 5]")
        if self.kind == FeedbackKind.COMPLETION:
            if self.value is None or not 0 <= self.value <= 1:
                raise ValueError("completion value must be in [0, 1]")
        return self


class ErrorBody(BaseModel):
    """Uniform error envelope for every non-2xx response."""

    code: str
    message: str
    request_id: str | None = None
