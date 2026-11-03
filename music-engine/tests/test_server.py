"""HTTP API tests: run the real server on a random local port and call it over HTTP."""

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from musicengine.audio_io import decode_wav
from musicengine.server import App, make_server

SR = 44100


def _call(method, url, body=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def _json(method, url, body=None, headers=None):
    status, raw, _ = _call(method, url, body, headers)
    return status, json.loads(raw) if raw else None


def _start(app_url, **overrides):
    body = {"prompt": "warm jazz at dusk", "instrumental": True, "duration_seconds": 5, "seed": 3}
    body.update(overrides)
    return _json("POST", f"{app_url}/v1/generations", body)


def _wait_terminal(app_url, job_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        _, job = _json("GET", f"{app_url}/v1/generations/{job_id}")
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.1)
    raise AssertionError("job did not finish in time")


def _parse_sse(raw: bytes):
    events = []
    for block in raw.decode("utf-8").split("\n\n"):
        name, seq, data = None, None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("id: "):
                seq = int(line[4:])
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name is not None:
            events.append((name, seq, data))
    return events


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    app = App(data_dir=tmp_path_factory.mktemp("server-data"))
    srv = make_server("127.0.0.1", 0, app)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()
    app.close()


def test_generate_poll_and_download_audio(server):
    status, job = _start(server)
    assert status == 202
    assert job["status"] in ("queued", "conditioning", "generating_tokens", "refining", "decoding", "succeeded")
    done = _wait_terminal(server, job["id"])
    assert done["status"] == "succeeded", done
    assert done["audio_url"] == f"/v1/generations/{job['id']}/audio"

    status, raw, headers = _call("GET", f"{server}/v1/generations/{job['id']}/audio")
    assert status == 200
    assert headers["Content-Type"] == "audio/wav"
    audio, rate = decode_wav(raw)
    assert rate == SR and audio.shape[0] == 2
    assert audio.shape[1] == 250 * 882   # 5 s at 50 frames/s, 882 samples per frame


def test_events_stream_has_status_and_ordered_tokens(server):
    _, job = _start(server, seed=5)
    status, raw, headers = _call("GET", f"{server}/v1/generations/{job['id']}/events")
    assert status == 200
    assert headers["Content-Type"] == "text/event-stream"
    events = _parse_sse(raw)
    names = {name for name, _, _ in events}
    assert {"status", "tokens"} <= names
    assert events[-1][0] == "status" and events[-1][2]["status"] == "succeeded"
    token_events = [(seq, data) for name, seq, data in events if name == "tokens"]
    seqs = [seq for seq, _ in token_events]
    assert seqs == sorted(seqs) and seqs[0] == 0
    assert sum(d["frame_count"] for _, d in token_events) == 250


def test_resume_with_last_event_id_skips_seen_tokens(server):
    _, job = _start(server, seed=6)
    _wait_terminal(server, job["id"])
    _, raw, _ = _call("GET", f"{server}/v1/generations/{job['id']}/events",
                      headers={"Last-Event-ID": "2"})
    token_seqs = [seq for name, seq, _ in _parse_sse(raw) if name == "tokens"]
    assert token_seqs and min(token_seqs) == 3


def test_cancel_stops_a_long_job(server):
    _, job = _start(server, duration_seconds=240, seed=7)
    status, _, _ = _call("POST", f"{server}/v1/generations/{job['id']}/cancel")
    assert status == 202
    done = _wait_terminal(server, job["id"])
    assert done["status"] == "cancelled"
    status, _, _ = _call("POST", f"{server}/v1/generations/{job['id']}/cancel")
    assert status == 409
    status, body, _ = _call("GET", f"{server}/v1/generations/{job['id']}/audio")
    assert status == 409


def test_validation_errors_return_400_with_message(server):
    status, body = _json("POST", f"{server}/v1/generations", {"prompt": ""})
    assert status == 400
    assert body["code"] == "invalid_request" and body["message"]

    status, body = _json("POST", f"{server}/v1/generations",
                         {"prompt": "x", "instrumental": True, "lyrics": "la la"})
    assert status == 400

    status, body = _json("POST", f"{server}/v1/generations", {"prompt": "x", "duration_seconds": 2})
    assert status == 400


def test_malformed_json_and_unknown_routes(server):
    req = urllib.request.Request(f"{server}/v1/generations", data=b"{not json", method="POST",
                                 headers={"Content-Type": "application/json"})
    with pytest.raises(urllib.error.HTTPError) as err:
        urllib.request.urlopen(req, timeout=10)
    assert err.value.code == 400
    status, body = _json("GET", f"{server}/v1/generations/gen_missing")
    assert status == 404 and body["code"] == "not_found"
    status, body = _json("GET", f"{server}/nope")
    assert status == 404


def test_idempotency_key_returns_same_job(server):
    headers = {"Idempotency-Key": "key-abc-123"}
    _, first = _json("POST", f"{server}/v1/generations",
                     {"prompt": "idempotent", "instrumental": True, "duration_seconds": 5, "seed": 8}, headers)
    _, second = _json("POST", f"{server}/v1/generations",
                      {"prompt": "idempotent", "instrumental": True, "duration_seconds": 5, "seed": 8}, headers)
    assert first["id"] == second["id"]
    status, body = _json("POST", f"{server}/v1/generations",
                         {"prompt": "different", "instrumental": True, "duration_seconds": 5}, headers)
    assert status == 409


def test_feedback_is_recorded_and_validated(server):
    status, raw, _ = _call("POST", f"{server}/v1/feedback",
                           {"job_id": "gen_x", "user_id": "u-1", "kind": "rating", "value": 4})
    assert status == 204
    status, body = _json("POST", f"{server}/v1/feedback",
                         {"job_id": "gen_x", "user_id": "u-1", "kind": "rating", "value": 9})
    assert status == 400


def test_api_key_is_required_when_configured(tmp_path):
    app = App(api_key="s3cret-test-key", data_dir=tmp_path)
    srv = make_server("127.0.0.1", 0, app)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        status, body = _json("POST", f"{url}/v1/generations", {"prompt": "x", "instrumental": True})
        assert status == 401 and body["code"] == "unauthorized"
        status, body = _json("POST", f"{url}/v1/generations", {"prompt": "x", "instrumental": True},
                             {"Authorization": "Bearer wrong"})
        assert status == 401
        status, body = _json("POST", f"{url}/v1/generations", {"prompt": "x", "instrumental": True, "duration_seconds": 5},
                             {"Authorization": "Bearer s3cret-test-key"})
        assert status == 202
    finally:
        srv.shutdown()
        srv.server_close()
        app.close()
