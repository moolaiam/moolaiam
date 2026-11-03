# musicengine

Text- and lyric-conditioned music generation: CLAP-style conditioning, an RVQ neural codec,
a decoder-only token engine, a conditional DDIM refiner, and a governed data pipeline with
privacy-preserving post-training.

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Its status ledger says which parts
are production-grade interfaces, which are reference implementations, and which are placeholders.

## Layout

```
src/musicengine/
  schemas.py          API models (GenerationRequest, TokenEvent, StatusEvent, FeedbackEvent ...)
  conditioning.py     text encoder contract, canonical prompt, section planner
  codec.py            DCT bottleneck + residual vector quantiser (fit with residual k-means)
  engine/
    autoregressive.py vocabulary, level-constrained sampler, streaming token engine
    diffusion.py      cosine schedule, DDIM, classifier-free guidance, reference denoiser
  orchestrator.py     end-to-end pipeline: status / token events, cancellation, timings
  audio_io.py         stdlib WAV encode/decode
  data/
    policy.py         source tiers, licence / robots / paywall gate, licensed-tier switch
    quality.py        corruption, silence, clipping, loudness, SNR proxy, bandwidth
    metadata.py       genre taxonomy, key validation, tempo estimate, lyric alignment
    ingest.py         manifest worker with accepted / rejected audit logs
  privacy.py          allowlist, keyed pseudonyms, PII scrubbing, final gate
  posttrain.py        implicit + explicit scoring, preference pairs
  cli.py              `render` and `ingest` commands
docs/
  ARCHITECTURE.md     diagram, service breakdown, data model, governance, status ledger
  api/openapi.yaml    REST + SSE contract (kept in sync with schemas.py by tests)
tests/                54 tests: codec, token constraints, DDIM exactness, pipeline, policy, privacy
```

## Quick start

```bash
pip install -e ".[test]"        # or: PYTHONPATH=src python -m pytest
python -m pytest -q

# render 20 s of audio
python -m musicengine render --prompt "warm jazz at dusk" --genre jazz --tempo 96 \
    --duration 20 --seed 3 --out song.wav

# curate a source manifest (one JSON object per line; see data/policy.py)
python -m musicengine ingest --manifest sources.jsonl --out curated/
```

## Using the pipeline from code

```python
from musicengine.orchestrator import MusicPipeline
from musicengine.schemas import GenerationRequest, TokenEvent, StatusEvent

pipeline = MusicPipeline.reference()
req = GenerationRequest(
    prompt="late-night synthwave, pulsing bass, distant sax",
    genres=["electronic"], tempo_bpm=108, key="Am",
    lyrics="[Verse]\nneon on the wet road\n[Chorus]\nkeep driving through the night",
    duration_seconds=30, seed=7,
)
for event in pipeline.run(req, job_id="demo"):
    if isinstance(event, TokenEvent):
        ...   # stream tokens to the client (SSE)
    elif isinstance(event, StatusEvent):
        ...   # progress
    else:
        audio = event.audio   # (2, T) float32, 44.1 kHz
```

## Notes

- The reference text encoder, token LM, denoiser and codec are deterministic stand-ins with the
  production contracts. They run on NumPy alone. Trained weights are not included, so output
  quality is not representative of a trained system.
- No secrets are read from the repository. The pseudonymisation key must be at least 32 bytes and
  is supplied by the caller from a secret store.
