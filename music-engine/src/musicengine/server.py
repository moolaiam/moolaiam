"""HTTP server implementing docs/api/openapi.yaml on top of MusicPipeline.

Standard library only. Jobs run one at a time on a worker thread, and all job state is in
memory, so jobs are lost on restart. This is a single-machine server for development and
testing, not a production deployment. Feedback is appended to a JSONL file in `data_dir`;
that file holds raw user ids and must stay restricted.
"""

from __future__ import annotations

import hmac
import json
import logging
import queue
import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pydantic import ValidationError

from musicengine.audio_io import encode_wav
from musicengine.orchestrator import MusicPipeline, PipelineCancelled, RenderResult
from musicengine.schemas import (
    TERMINAL_STATUSES,
    ErrorBody,
    FeedbackEvent,
    GenerationJob,
    GenerationRequest,
    GenerationStatus,
    StatusEvent,
    TokenEvent,
)

log = logging.getLogger("musicengine.server")

MAX_BODY_BYTES = 64 * 1024
MAX_QUEUED_JOBS = 16
API_KEY_ENV = "MUSICENGINE_API_KEY"
_JOB_PATH = re.compile(r"/v1/generations/([A-Za-z0-9_-]+)(/events|/audio|/cancel)?")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    id: str
    request: GenerationRequest
    status: GenerationStatus = GenerationStatus.QUEUED
    progress: float = 0.0
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    tokens_emitted: int = 0
    audio: bytes | None = None
    idempotency_key: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    # (event name, JSON data, SSE id or None). Append-only; SSE readers keep an index.
    events: list[tuple[str, str, int | None]] = field(default_factory=list)

    def to_model(self) -> GenerationJob:
        return GenerationJob(
            id=self.id,
            status=self.status,
            created_at=self.created_at,
            updated_at=self.updated_at,
            request=self.request,
            progress=self.progress,
            error=self.error,
            audio_url=f"/v1/generations/{self.id}/audio" if self.status == GenerationStatus.SUCCEEDED else None,
            tokens_emitted=self.tokens_emitted,
        )


class JobStore:
    def __init__(self) -> None:
        self.cond = threading.Condition()
        self._jobs: dict[str, Job] = {}
        self._by_key: dict[str, str] = {}

    def add(self, job: Job) -> None:
        with self.cond:
            self._jobs[job.id] = job
            if job.idempotency_key:
                self._by_key[job.idempotency_key] = job.id

    def remove(self, job: Job) -> None:
        with self.cond:
            self._jobs.pop(job.id, None)
            if job.idempotency_key:
                self._by_key.pop(job.idempotency_key, None)

    def get(self, job_id: str) -> Job | None:
        with self.cond:
            return self._jobs.get(job_id)

    def by_key(self, key: str) -> Job | None:
        with self.cond:
            job_id = self._by_key.get(key)
            return self._jobs.get(job_id) if job_id else None

    def update(
        self,
        job: Job,
        *,
        status: GenerationStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
        audio: bytes | None = None,
    ) -> None:
        """Change job state. A status change also appends a status event for SSE clients."""
        with self.cond:
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = progress
            if error is not None:
                job.error = error
            if audio is not None:
                job.audio = audio
            job.updated_at = _now()
            if status is not None:
                payload = StatusEvent(job_id=job.id, status=job.status,
                                      progress=job.progress, error=job.error)
                job.events.append(("status", payload.model_dump_json(), None))
            self.cond.notify_all()

    def add_tokens(self, job: Job, event: TokenEvent) -> None:
        with self.cond:
            job.tokens_emitted += len(event.tokens)
            job.events.append(("tokens", event.model_dump_json(), event.sequence))
            self.cond.notify_all()


class GenerationWorker(threading.Thread):
    def __init__(self, store: JobStore, pipeline: MusicPipeline) -> None:
        super().__init__(name="generation-worker", daemon=True)
        self.store = store
        self.pipeline = pipeline
        self.jobs: queue.Queue[Job | None] = queue.Queue(maxsize=MAX_QUEUED_JOBS)

    def submit(self, job: Job) -> bool:
        try:
            self.jobs.put_nowait(job)
            return True
        except queue.Full:
            return False

    def stop(self) -> None:
        self.jobs.put(None)

    def run(self) -> None:
        while True:
            job = self.jobs.get()
            if job is None:
                return
            try:
                self._run_job(job)
            except Exception:  # never let one job kill the worker
                log.exception("worker failed on job %s", job.id)

    def _run_job(self, job: Job) -> None:
        if job.cancel.is_set():
            self.store.update(job, status=GenerationStatus.CANCELLED)
            return
        try:
            for event in self.pipeline.run(job.request, job.id, job.cancel):
                if isinstance(event, RenderResult):
                    wav = encode_wav(event.audio, event.sample_rate)
                    self.store.update(job, audio=wav, status=GenerationStatus.SUCCEEDED, progress=1.0)
                elif isinstance(event, StatusEvent):
                    self.store.update(job, status=event.status, progress=event.progress)
                elif isinstance(event, TokenEvent):
                    self.store.add_tokens(job, event)
        except PipelineCancelled:
            self.store.update(job, status=GenerationStatus.CANCELLED)
        except Exception:
            log.exception("generation %s failed", job.id)
            # Internal details stay in the log; clients get a generic message.
            self.store.update(job, status=GenerationStatus.FAILED,
                              error="internal error during generation")


class App:
    """Shared state for the HTTP handlers. Owns the worker thread."""

    def __init__(
        self,
        pipeline: MusicPipeline | None = None,
        api_key: str | None = None,
        data_dir: str | Path = "server-data",
    ) -> None:
        self.store = JobStore()
        self.pipeline = pipeline or MusicPipeline.reference()
        self.api_key = api_key or None
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.feedback_path = self.data_dir / "feedback.jsonl"
        self._feedback_lock = threading.Lock()
        self.worker = GenerationWorker(self.store, self.pipeline)
        self.worker.start()

    def close(self) -> None:
        self.worker.stop()
        self.worker.join(timeout=10)

    def append_feedback(self, event: FeedbackEvent) -> None:
        line = json.dumps(event.model_dump(mode="json"))
        with self._feedback_lock, self.feedback_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


class Handler(BaseHTTPRequestHandler):
    server_version = "musicengine/0.1"

    @property
    def app(self) -> App:
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, format: str, *args) -> None:  # keep test and CLI output quiet
        log.debug("%s - %s", self.address_string(), format % args)

    # ------------------------------------------------------------ dispatch
    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        if not self._authorized():
            return self._error(401, "unauthorized", "missing or invalid API key")
        path = self.path.partition("?")[0]
        if method == "POST" and path == "/v1/generations":
            return self._create()
        if method == "POST" and path == "/v1/feedback":
            return self._feedback()
        match = _JOB_PATH.fullmatch(path)
        if match:
            job = self.app.store.get(match.group(1))
            if job is None:
                return self._error(404, "not_found", "no such generation")
            sub = match.group(2)
            if method == "GET" and sub is None:
                return self._json(200, job.to_model().model_dump(mode="json"))
            if method == "GET" and sub == "/events":
                return self._events(job)
            if method == "GET" and sub == "/audio":
                return self._audio(job)
            if method == "POST" and sub == "/cancel":
                return self._cancel(job)
        self._error(404, "not_found", "no such route")

    def _authorized(self) -> bool:
        expected = self.app.api_key
        if expected is None:
            return True
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied.encode(), f"Bearer {expected}".encode())

    # ------------------------------------------------------------ endpoints
    def _create(self) -> None:
        body = self._read_json()
        if body is None:
            return
        try:
            request = GenerationRequest.model_validate(body)
        except ValidationError as exc:
            first = exc.errors()[0]
            where = ".".join(str(p) for p in first["loc"])
            return self._error(400, "invalid_request", f"{where}: {first['msg']}")

        key = self.headers.get("Idempotency-Key")
        if key:
            existing = self.app.store.by_key(key)
            if existing is not None:
                if existing.request == request:
                    return self._json(202, existing.to_model().model_dump(mode="json"))
                return self._error(409, "idempotency_conflict",
                                   "Idempotency-Key was already used with a different request")

        job = Job(id=f"gen_{uuid.uuid4().hex}", request=request, idempotency_key=key)
        self.app.store.add(job)
        if not self.app.worker.submit(job):
            self.app.store.remove(job)
            return self._error(429, "queue_full", "too many generations queued; retry shortly")
        self._json(202, job.to_model().model_dump(mode="json"))

    def _events(self, job: Job) -> None:
        last = self.headers.get("Last-Event-ID", "")
        last_id = int(last) if last.isdigit() else None
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        store = self.app.store
        index = 0
        try:
            while True:
                with store.cond:
                    while index >= len(job.events) and job.status not in TERMINAL_STATUSES:
                        if not store.cond.wait(timeout=15):
                            break
                    pending = job.events[index:]
                    index = len(job.events)
                    finished = job.status in TERMINAL_STATUSES
                if not pending:
                    self.wfile.write(b": keep-alive\n\n")
                for name, data, seq in pending:
                    if name == "tokens" and last_id is not None and seq is not None and seq <= last_id:
                        continue  # client already has this chunk
                    chunk = f"event: {name}\n"
                    if seq is not None:
                        chunk += f"id: {seq}\n"
                    chunk += f"data: {data}\n\n"
                    self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
                if finished and index == len(job.events):
                    return
        except (BrokenPipeError, ConnectionResetError):
            return

    def _audio(self, job: Job) -> None:
        if job.status != GenerationStatus.SUCCEEDED or job.audio is None:
            return self._error(409, "not_ready", f"audio is not available (status: {job.status.value})")
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(job.audio)))
        self.end_headers()
        self.wfile.write(job.audio)

    def _cancel(self, job: Job) -> None:
        if job.status in TERMINAL_STATUSES:
            return self._error(409, "already_finished", f"job is already {job.status.value}")
        job.cancel.set()
        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _feedback(self) -> None:
        body = self._read_json()
        if body is None:
            return
        try:
            event = FeedbackEvent.model_validate(body)
        except ValidationError as exc:
            first = exc.errors()[0]
            where = ".".join(str(p) for p in first["loc"])
            return self._error(400, "invalid_request", f"{where}: {first['msg']}")
        self.app.append_feedback(event)
        self.send_response(204)
        self.end_headers()

    # ------------------------------------------------------------ helpers
    def _read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._error(400, "invalid_request", "bad Content-Length")
            return None
        if length > MAX_BODY_BYTES:
            self._error(413, "too_large", f"body exceeds {MAX_BODY_BYTES} bytes")
            return None
        raw = self.rfile.read(length) if length else b""
        try:
            value = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._error(400, "invalid_json", "request body is not valid JSON")
            return None
        if not isinstance(value, dict):
            self._error(400, "invalid_request", "request body must be a JSON object")
            return None
        return value

    def _json(self, status: int, obj: dict) -> None:
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, ErrorBody(code=code, message=message).model_dump())


class MusicServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], app: App) -> None:
        super().__init__(address, Handler)
        self.app = app


def make_server(host: str, port: int, app: App) -> MusicServer:
    return MusicServer((host, port), app)
