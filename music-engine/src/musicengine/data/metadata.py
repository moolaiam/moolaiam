"""Metadata cleaning and audio-text alignment for curated tracks.

Each cleaned record carries: normalised genre tags (from a closed taxonomy),
a validated key, a tempo that is both declared and estimated (with a
mismatch flag), and lyric sections checked against track duration. Problems
are recorded as `flags` rather than silently fixed, so downstream filtering
stays auditable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from musicengine.schemas import KEY_PATTERN, SECTION_TAG

GENRE_TAXONOMY = frozenset(
    {
        "ambient", "classical", "country", "dance", "electronic", "folk", "funk",
        "hip-hop", "house", "jazz", "latin", "metal", "pop", "punk", "rnb", "rock",
        "soul", "techno", "trap", "world",
    }
)
GENRE_SYNONYMS = {
    "hip hop": "hip-hop", "hiphop": "hip-hop", "rap": "hip-hop",
    "r&b": "rnb", "r and b": "rnb", "rhythm and blues": "rnb",
    "edm": "electronic", "electro": "electronic", "electronica": "electronic",
    "rock and roll": "rock", "rock n roll": "rock",
}
MAX_WORDS_PER_SECOND = 5.0       # faster than this is almost certainly misaligned
TEMPO_RANGE = (40.0, 240.0)


@dataclass
class CleanedMetadata:
    genres: list[str] = field(default_factory=list)
    key: str | None = None
    tempo_declared: float | None = None
    tempo_estimated: float | None = None
    lyric_sections: list[dict] = field(default_factory=list)
    instrumental: bool = True
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def normalize_genres(raw: list[str], flags: list[str]) -> list[str]:
    out: list[str] = []
    for g in raw:
        key = re.sub(r"\s+", " ", str(g).strip().lower())
        key = GENRE_SYNONYMS.get(key, key).replace(" ", "-")
        if key in GENRE_TAXONOMY:
            if key not in out:
                out.append(key)
        else:
            flags.append(f"unknown_genre:{key}")
    return out


def normalize_key(raw: str | None, flags: list[str]) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if len(s) >= 2 and s[0].isalpha():
        s = s[0].upper() + s[1:]
        if s.endswith("M") and not s.endswith("m"):
            s = s[:-1] + "m"
    if re.match(KEY_PATTERN, s):
        return s
    flags.append("invalid_key")
    return None


def estimate_tempo(mono: np.ndarray, sr: int) -> float | None:
    """Onset-envelope autocorrelation tempo estimate, in BPM. None if unreliable."""
    hop = 512
    n = mono.size // hop
    if n < 64:
        return None
    frames = mono[: n * hop].reshape(n, hop)
    energy = np.log1p(np.sqrt(np.mean(frames**2, axis=1)) * 100.0)
    onset = np.maximum(np.diff(energy, prepend=energy[0]), 0.0)
    onset = onset - onset.mean()
    if not np.any(onset):
        return None
    fps = sr / hop
    ac = np.correlate(onset, onset, mode="full")[onset.size - 1:]
    lo = int(fps * 60.0 / TEMPO_RANGE[1])
    hi = min(int(fps * 60.0 / TEMPO_RANGE[0]), ac.size - 1)
    if hi <= lo:
        return None
    lag = lo + int(np.argmax(ac[lo:hi + 1]))
    if ac[lag] <= 0:
        return None
    return float(60.0 * fps / lag)


def parse_lyrics(lyrics: str | None) -> list[dict]:
    if not lyrics or not lyrics.strip():
        return []
    matches = list(SECTION_TAG.finditer(lyrics))
    if not matches:
        body = lyrics.strip()
        return [{"name": "verse", "lines": [ln.strip() for ln in body.splitlines() if ln.strip()]}]
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(lyrics)
        lines = [ln.strip() for ln in lyrics[m.end():end].splitlines() if ln.strip()]
        out.append({"name": m.group("name").strip().lower(), "lines": lines})
    return out


def clean_metadata(
    raw: dict,
    *,
    duration_s: float,
    mono: np.ndarray | None = None,
    sample_rate: int | None = None,
) -> CleanedMetadata:
    """Normalise one track's metadata. `raw` keys: genres, key, tempo_bpm, lyrics."""
    flags: list[str] = []
    meta = CleanedMetadata()
    meta.genres = normalize_genres(raw.get("genres", []) or [], flags)
    meta.key = normalize_key(raw.get("key"), flags)

    declared = raw.get("tempo_bpm")
    if declared is not None:
        declared = float(declared)
        if TEMPO_RANGE[0] <= declared <= TEMPO_RANGE[1]:
            meta.tempo_declared = declared
        else:
            flags.append("tempo_out_of_range")

    if mono is not None and sample_rate:
        est = estimate_tempo(mono, sample_rate)
        meta.tempo_estimated = est
        if est is not None and meta.tempo_declared is not None:
            ratio = meta.tempo_declared / est
            # Octave errors (x2, /2, x3, /3) are common in tempo estimators; allow them.
            octave_ok = any(abs(ratio - r) / r < 0.05 for r in (0.5, 1.0, 2.0, 1 / 3, 3.0))
            if not octave_ok:
                flags.append("tempo_mismatch")

    sections = parse_lyrics(raw.get("lyrics"))
    meta.lyric_sections = sections
    words = sum(len(" ".join(s["lines"]).split()) for s in sections)
    meta.instrumental = words == 0
    if words and duration_s > 0 and words / duration_s > MAX_WORDS_PER_SECOND:
        flags.append("lyrics_duration_mismatch")

    meta.flags = flags
    return meta
