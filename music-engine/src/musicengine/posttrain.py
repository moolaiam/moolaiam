"""Post-training dataset construction from anonymised activity.

Turns per-generation feedback into preference pairs (chosen, rejected) for
DPO-style alignment, and into scored examples for reward-model fitting.
Input rows must come from `privacy.anonymize_feedback`; this module does not
see raw user ids.

Implicit signals are folded into one score on a 1..5 scale:
    score = explicit rating (if any), else 3
            + 1.0 * completion fraction (0..1)     # listened to the end
            + 0.5 * (extends > 0)                 # asked for more of it
            - 0.5 * (edits > 0)                   # rewrote the prompt: likely dissatisfied
Weights are constants so they are versioned with the code.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

W_COMPLETION = 1.0
W_EXTEND = 0.5
W_EDIT = 0.5
MIN_SCORE_GAP = 1.5


@dataclass(frozen=True)
class ScoredGeneration:
    generation_pseudonym: str
    prompt_hash: str
    score: float


def score_generations(rows: list[dict]) -> list[ScoredGeneration]:
    grouped: dict[str, dict] = defaultdict(lambda: {"rating": None, "completion": None,
                                                    "extend": 0, "edit": 0, "prompt": None})
    for r in rows:
        g = grouped[r["generation_pseudonym"]]
        g["prompt"] = r["prompt_hash"]
        kind, value = r["kind"], r.get("value")
        if kind == "rating":
            g["rating"] = value
        elif kind == "completion":
            g["completion"] = value
        elif kind == "extend":
            g["extend"] += 1
        elif kind == "edit":
            g["edit"] += 1
    out = []
    for gen_id, g in grouped.items():
        base = g["rating"] if g["rating"] is not None else 3.0
        score = base + W_COMPLETION * (g["completion"] or 0.0)
        score += W_EXTEND * (g["extend"] > 0) - W_EDIT * (g["edit"] > 0)
        out.append(ScoredGeneration(gen_id, g["prompt"], float(score)))
    return out


def build_preference_pairs(scored: list[ScoredGeneration]) -> list[dict]:
    """Pair best and worst generations for the same prompt, when the gap is meaningful."""
    by_prompt: dict[str, list[ScoredGeneration]] = defaultdict(list)
    for s in scored:
        by_prompt[s.prompt_hash].append(s)
    pairs = []
    for prompt_hash, items in by_prompt.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda s: s.score)
        worst, best = items[0], items[-1]
        if best.score - worst.score >= MIN_SCORE_GAP:
            pairs.append({
                "prompt_hash": prompt_hash,
                "chosen": best.generation_pseudonym,
                "rejected": worst.generation_pseudonym,
                "margin": round(best.score - worst.score, 3),
            })
    return pairs
