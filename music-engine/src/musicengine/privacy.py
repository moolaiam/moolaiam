"""Privacy-by-design anonymisation for post-training data.

Raw feedback (with `user_id`) stays in the operational store. Only the output
of `anonymize_feedback` may enter a post-training dataset. The layer:

1. Keeps an explicit ALLOWLIST of fields. Unknown fields are dropped, so a
   new PII column added upstream cannot leak by default.
2. Replaces the account id with a keyed HMAC pseudonym. The key is held
   outside the data store and rotated per epoch, so pseudonyms cannot be
   joined across epochs and cannot be reversed without the key.
3. Scrubs free text (prompts, lyrics) for e-mail addresses, phone numbers,
   URLs, IP addresses, @handles and long digit runs (card / account numbers).
4. Coarsens timestamps to the day.
5. Re-checks every output record with `assert_no_pii` before it is written.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import datetime

ALLOWED_FIELDS = frozenset(
    {"event_pseudonym", "generation_pseudonym", "user_pseudonym", "prompt_hash",
     "kind", "value", "day", "prompt_scrubbed", "lyrics_scrubbed", "genres", "moods",
     "tempo_bpm", "key", "instrumental", "duration_seconds", "epoch"}
)

_PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "url": re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE),
    "ipv4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    # At least 10 digits, so dates (2026-11-02) and short numbers do not match.
    "phone": re.compile(r"(?<!\w)(?=(?:\D*\d){10})\+?\d[\d\s().-]{8,}\d(?!\w)"),
    "handle": re.compile(r"(?<!\w)@[A-Za-z0-9_]{2,30}\b"),
    "long_digits": re.compile(r"\b(?:\d[ -]?){12,19}\b"),
}
_TOKENS = {"email": "[EMAIL]", "url": "[URL]", "ipv4": "[IP]", "phone": "[PHONE]",
           "handle": "[HANDLE]", "long_digits": "[NUMBER]"}


class PrivacyViolation(ValueError):
    pass


def scrub_text(text: str | None) -> str | None:
    if text is None:
        return None
    out = text
    # Order matters: URLs and e-mails before phone/digit patterns.
    for name in ("url", "email", "ipv4", "handle", "long_digits", "phone"):
        out = _PATTERNS[name].sub(_TOKENS[name], out)
    return out


def find_pii(text: str) -> list[str]:
    return [name for name, pat in _PATTERNS.items() if pat.search(text)]


@dataclass(frozen=True)
class Pseudonymizer:
    key: bytes
    epoch: str   # e.g. "2026-Q4"; changing it breaks linkability across epochs

    def __post_init__(self) -> None:
        if len(self.key) < 32:
            raise ValueError("pseudonymisation key must be at least 32 bytes")

    def pseudonym(self, scope: str, value: str) -> str:
        msg = f"{self.epoch}|{scope}|{value}".encode("utf-8")
        return hmac.new(self.key, msg, hashlib.sha256).hexdigest()[:24]


FREE_TEXT_FIELDS = frozenset({"prompt_scrubbed", "lyrics_scrubbed", "genres", "moods"})
FORBIDDEN_FIELDS = frozenset({"user_id", "email", "ip", "device_id", "session_id", "account_id"})


def assert_no_pii(record: dict) -> None:
    """Final gate before a row is written. Structural fields are allowlisted by name;
    only free-text fields are pattern-scanned (hashes and dates would false-positive)."""
    extra = set(record) - ALLOWED_FIELDS
    if extra:
        raise PrivacyViolation(f"non-allowlisted fields: {sorted(extra)}")
    if FORBIDDEN_FIELDS & set(record):
        raise PrivacyViolation(f"forbidden identifier fields present: {sorted(FORBIDDEN_FIELDS & set(record))}")
    for k in FREE_TEXT_FIELDS & set(record):
        values = record[k] if isinstance(record[k], list) else [record[k]]
        for v in values:
            if isinstance(v, str) and (hits := find_pii(v)):
                raise PrivacyViolation(f"field {k!r} still contains: {hits}")


def prompt_fingerprint(canonical_prompt: str, pseudo: Pseudonymizer) -> str:
    """Stable, keyed hash used to group feedback on the same prompt without storing it."""
    return pseudo.pseudonym("prompt", canonical_prompt.strip().lower())


def anonymize_feedback(
    feedback: dict,
    generation: dict,
    pseudo: Pseudonymizer,
) -> dict:
    """Build one post-training row from a raw feedback event and its generation request.

    `feedback`: job_id, user_id, kind, value, occurred_at
    `generation`: job_id, request (GenerationRequest dict)
    """
    req = generation["request"]
    canonical = f"{req.get('prompt', '')}"
    occurred = feedback["occurred_at"]
    day = occurred.date().isoformat() if isinstance(occurred, datetime) else str(occurred)[:10]
    row = {
        "event_pseudonym": pseudo.pseudonym("event", feedback["job_id"] + feedback["kind"] + day),
        "generation_pseudonym": pseudo.pseudonym("generation", feedback["job_id"]),
        "user_pseudonym": pseudo.pseudonym("user", feedback["user_id"]),
        "prompt_hash": prompt_fingerprint(canonical, pseudo),
        "kind": feedback["kind"],
        "value": feedback.get("value"),
        "day": day,
        "prompt_scrubbed": scrub_text(req.get("prompt")),
        "lyrics_scrubbed": scrub_text(req.get("lyrics")),
        "genres": list(req.get("genres", [])),
        "moods": list(req.get("moods", [])),
        "tempo_bpm": req.get("tempo_bpm"),
        "key": req.get("key"),
        "instrumental": bool(req.get("instrumental", False)),
        "duration_seconds": req.get("duration_seconds"),
        "epoch": pseudo.epoch,
    }
    assert_no_pii(row)
    return row
