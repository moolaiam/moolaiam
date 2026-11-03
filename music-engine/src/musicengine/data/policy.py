"""Ingestion governance: which sources may enter the training corpus, and under what terms.

Two tiers, enforced in code rather than by convention:

* OPEN_WEB  - public audio whose licence is on the permissive allowlist, whose
              host's robots.txt permits the crawl, and that carries no paywall
              or access control. The worker never fetches anything itself; it
              only reads files that an upstream, policy-checked acquisition
              step has already placed on disk.
* LICENSED  - catalogue audio covered by an active, registered contract id.
              Disabled unless `allow_licensed` is set (v6+ model tier).

Anything else is rejected with a machine-readable reason, and the reason is
written to the audit manifest so every exclusion is explainable.

Note on named metadata sources (YouTube Music, Genius, Deezer): their terms
generally prohibit bulk audio downloading and scraping of lyrics. This
pipeline therefore does not include acquisition adapters for them. Metadata
should come from each provider's official API under its own licence, and
audio must come through one of the two tiers above.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

OPEN_LICENSES = frozenset({"cc0-1.0", "cc-by-4.0", "cc-by-sa-4.0", "public-domain"})


class SourceTier(str, Enum):
    OPEN_WEB = "open_web"
    LICENSED = "licensed"


@dataclass(frozen=True)
class SourceRecord:
    track_id: str
    audio_path: str
    tier: SourceTier
    license: str
    source_url: str | None = None
    robots_allowed: bool | None = None   # None = not checked -> rejected for OPEN_WEB
    paywalled: bool = False
    access_restricted: bool = False      # login / password / DRM / token-gated
    contract_id: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class IngestPolicy:
    licensed_contracts: frozenset[str] = frozenset()
    allow_licensed: bool = False         # flip on for the v6 model tier only

    def check(self, rec: SourceRecord) -> list[str]:
        """Return rejection reasons; an empty list means the source is admissible."""
        if rec.access_restricted or rec.paywalled:
            return ["access_restricted"]

        if rec.tier == SourceTier.OPEN_WEB:
            reasons: list[str] = []
            if not rec.source_url:
                reasons.append("missing_source_url")
            if rec.robots_allowed is None:
                reasons.append("robots_unchecked")
            elif rec.robots_allowed is False:
                reasons.append("robots_disallowed")
            if rec.license.lower() not in OPEN_LICENSES:
                reasons.append("license_not_permitted")
            return reasons

        if rec.tier == SourceTier.LICENSED:
            if not self.allow_licensed:
                return ["licensed_tier_not_enabled"]
            if not rec.contract_id or rec.contract_id not in self.licensed_contracts:
                return ["no_active_contract"]
            return []

        return ["unknown_tier"]
