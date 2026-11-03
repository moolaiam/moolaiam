"""Ingestion worker: manifest rows -> policy gate -> signal QC -> metadata cleaning -> audit log.

Input  : JSONL manifest; one `SourceRecord` per line (see policy.py).
Output : accepted.jsonl (cleaned, training-ready records) and
         rejected.jsonl (every exclusion with its reasons), plus a summary.

Every row is processed independently, so a corrupt file or a bad row never
aborts the run. The audio loader is injectable so non-WAV formats can be
added by decoding upstream.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

import numpy as np

from musicengine.audio_io import read_wav_file
from musicengine.data.metadata import clean_metadata
from musicengine.data.policy import IngestPolicy, SourceRecord, SourceTier
from musicengine.data.quality import QualityThresholds, assess_audio, thresholds_as_dict

log = logging.getLogger(__name__)

AudioLoader = Callable[[str], tuple[np.ndarray, int]]


@dataclass
class IngestSummary:
    seen: int = 0
    accepted: int = 0
    rejected: int = 0
    reasons: Counter = field(default_factory=Counter)

    def to_dict(self) -> dict:
        return {"seen": self.seen, "accepted": self.accepted,
                "rejected": self.rejected, "reasons": dict(self.reasons.most_common())}


def parse_manifest(lines: Iterable[str]) -> Iterator[SourceRecord]:
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        d = json.loads(raw)
        d["tier"] = SourceTier(d["tier"])
        yield SourceRecord(**d)


def process_record(
    rec: SourceRecord,
    policy: IngestPolicy,
    thr: QualityThresholds,
    loader: AudioLoader = read_wav_file,
) -> tuple[dict | None, list[str], dict]:
    """Return (accepted_record | None, rejection_reasons, quality_metrics)."""
    policy_reasons = policy.check(rec)
    if policy_reasons:
        return None, policy_reasons, {}

    try:
        audio, sr = loader(rec.audio_path)
    except (OSError, ValueError, EOFError) as exc:  # decode_wav maps wave.Error to ValueError
        log.info("unreadable audio %s: %s", rec.track_id, exc)
        return None, ["corrupt_or_unsupported_format"], {}

    report = assess_audio(audio, sr, thr)
    if not report.passed:
        return None, list(report.reasons), report.metrics

    duration = audio.shape[1] / sr
    mono = audio.mean(axis=0)
    meta = clean_metadata(rec.metadata, duration_s=duration, mono=mono, sample_rate=sr)
    accepted = {
        "track_id": rec.track_id,
        "tier": rec.tier.value,
        "license": rec.license.lower(),
        "source_url": rec.source_url,
        "contract_id": rec.contract_id,
        "duration_s": round(duration, 3),
        "sample_rate": sr,
        "metadata": meta.to_dict(),
        "quality": report.metrics,
    }
    return accepted, [], report.metrics


def run_ingest(
    manifest_lines: Iterable[str],
    out_dir: str | Path,
    policy: IngestPolicy,
    thr: QualityThresholds | None = None,
    loader: AudioLoader = read_wav_file,
) -> IngestSummary:
    thr = thr or QualityThresholds()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    summary = IngestSummary()
    with (out / "accepted.jsonl").open("w", encoding="utf-8") as acc_f, \
            (out / "rejected.jsonl").open("w", encoding="utf-8") as rej_f:
        for rec in parse_manifest(manifest_lines):
            summary.seen += 1
            accepted, reasons, metrics = process_record(rec, policy, thr, loader)
            if accepted is None:
                summary.rejected += 1
                summary.reasons.update(reasons)
                rej_f.write(json.dumps({"track_id": rec.track_id, "reasons": reasons,
                                        "metrics": metrics}) + "\n")
            else:
                summary.accepted += 1
                acc_f.write(json.dumps(accepted) + "\n")
    (out / "summary.json").write_text(json.dumps({
        "summary": summary.to_dict(),
        "thresholds": thresholds_as_dict(thr),
        "policy": {
            "allow_licensed": policy.allow_licensed,
            "licensed_contracts": sorted(policy.licensed_contracts),
        },
    }, indent=2), encoding="utf-8")
    return summary
