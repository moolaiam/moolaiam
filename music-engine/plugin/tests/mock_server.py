"""Mock of the generation API, for testing the plug-in's network path without the real server.

Implements the endpoints in docs/api/openapi.yaml that EngineClient uses:
  POST /v1/generations, GET /v1/generations/{id}, GET .../audio, POST .../cancel.
The job succeeds on the first poll and serves a 2-second stereo sine as WAV.

Run:  python3 tests/mock_server.py            (prints "PORT <n>" then serves)
"""

import argparse
import json
import math
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from musicengine.audio_io import encode_wav  # noqa: E402

JOB_ID = "mock-job-1"
SR = 44100
WAV = encode_wav(
    np.stack([0.3 * np.sin(2 * math.pi * 440 * np.arange(2 * SR) / SR)] * 2).astype(np.float32), SR
)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/v1/generations":
            if not body.get("prompt"):
                return self._json(400, {"code": "invalid", "message": "prompt is required"})
            return self._json(202, {"id": JOB_ID, "status": "queued", "progress": 0.0, "tokens_emitted": 0,
                                    "request": body})
        if self.path == f"/v1/generations/{JOB_ID}/cancel":
            self.send_response(202)
            self.end_headers()
            return
        self._json(404, {"code": "not_found", "message": self.path})

    def do_GET(self):
        if self.path == f"/v1/generations/{JOB_ID}":
            return self._json(200, {"id": JOB_ID, "status": "succeeded", "progress": 1.0, "tokens_emitted": 0,
                                    "request": {"prompt": "mock"}})
        if self.path == f"/v1/generations/{JOB_ID}/audio":
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(WAV)))
            self.end_headers()
            self.wfile.write(WAV)
            return
        self._json(404, {"code": "not_found", "message": self.path})

    def log_message(self, *args):  # keep test output clean
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"PORT {server.server_address[1]}", flush=True)
    server.serve_forever()
