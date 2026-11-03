"""Command-line entry points.

    python -m musicengine render --prompt "warm jazz at dusk" --duration 20 --out song.wav
    python -m musicengine ingest --manifest sources.jsonl --out curated/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from musicengine.audio_io import encode_wav
from musicengine.data.ingest import run_ingest
from musicengine.data.policy import IngestPolicy
from musicengine.orchestrator import MusicPipeline
from musicengine.schemas import GenerationRequest, StatusEvent, TokenEvent


def _render(args: argparse.Namespace) -> int:
    req = GenerationRequest(
        prompt=args.prompt,
        genres=args.genre or [],
        moods=args.mood or [],
        tempo_bpm=args.tempo,
        key=args.key,
        lyrics=Path(args.lyrics).read_text(encoding="utf-8") if args.lyrics else None,
        instrumental=args.instrumental,
        duration_seconds=args.duration,
        seed=args.seed,
    )
    pipeline = MusicPipeline.reference()
    result = None
    for ev in pipeline.run(req, job_id="cli"):
        if isinstance(ev, StatusEvent) and args.verbose:
            print(f"[{ev.status.value}] {ev.progress:.0%}", file=sys.stderr)
        elif isinstance(ev, TokenEvent) and args.verbose:
            print(f"  tokens chunk {ev.sequence}: frames {ev.frame_start}..{ev.frame_start + ev.frame_count}",
                  file=sys.stderr)
        else:
            result = ev
    assert result is not None
    Path(args.out).write_bytes(encode_wav(result.audio, result.sample_rate))
    print(json.dumps({"out": args.out, "seconds": result.audio.shape[1] / result.sample_rate,
                      "seed": result.seed, "timings_ms": {k: round(v, 1) for k, v in result.timings_ms.items()}}))
    return 0


def _ingest(args: argparse.Namespace) -> int:
    policy = IngestPolicy(allow_licensed=args.allow_licensed)
    with open(args.manifest, encoding="utf-8") as fh:
        summary = run_ingest(fh, args.out, policy)
    print(json.dumps(summary.to_dict(), indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="musicengine")
    sub = parser.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("render", help="render a WAV from a prompt")
    r.add_argument("--prompt", required=True)
    r.add_argument("--genre", action="append")
    r.add_argument("--mood", action="append")
    r.add_argument("--tempo", type=int)
    r.add_argument("--key")
    r.add_argument("--lyrics", help="path to a UTF-8 lyrics file with [Section] tags")
    r.add_argument("--instrumental", action="store_true")
    r.add_argument("--duration", type=float, default=30.0)
    r.add_argument("--seed", type=int)
    r.add_argument("--out", default="out.wav")
    r.add_argument("-v", "--verbose", action="store_true")
    r.set_defaults(func=_render)

    i = sub.add_parser("ingest", help="curate a JSONL source manifest")
    i.add_argument("--manifest", required=True)
    i.add_argument("--out", required=True)
    i.add_argument("--allow-licensed", action="store_true", help="enable the v6 licensed tier")
    i.set_defaults(func=_ingest)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
