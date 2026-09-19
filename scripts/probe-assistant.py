"""Verification probe for the production Falcon AI endpoint (api/assistant.py).

Exercises key resolution, JSON extraction, the model fallback chain, and the
graceful no-key path — entirely with fake local values (no real secrets, no
network: the Mistral call is monkeypatched).

Run from repo root: python3 scripts/probe-assistant.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.request

sys.path.insert(0, "api")

FAKE_VARIANT = "test-key-123"  # fake value, exercises the "Mistral_API_KEY" spelling
FAKE_MAIN = "real-key-line1\nMISTRAL_API_KEY=garbage"  # malformed .env glue simulation


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, "api/assistant.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    os.environ.pop("MISTRAL_API_KEY", None)
    os.environ["Mistral_API_KEY"] = FAKE_VARIANT
    m = load("api_assistant")
    assert m._mistral_key() == FAKE_VARIANT, "variant key name failed"
    print("PASS  key variant resolution (Mistral_API_KEY)")

    os.environ["MISTRAL_API_KEY"] = FAKE_MAIN
    assert m._mistral_key() == "real-key-line1", "multiline key handling failed"
    print("PASS  malformed .env glue protection")
    os.environ.pop("MISTRAL_API_KEY", None)
    os.environ["Mistral_API_KEY"] = FAKE_VARIANT

    assert m._extract_json('```json\n{"reply":"hi","command":null}\n```') == {"reply": "hi", "command": None}
    assert m._extract_json('Sure! {"reply":"yo","command":{"type":"zoomIn"}}') == {"reply": "yo", "command": {"type": "zoomIn"}}
    assert m._extract_json("plain prose fallback") == {"reply": "plain prose fallback", "command": None}
    print("PASS  JSON extraction (fences / prose / plain)")

    seen: list[str] = []

    class FakeUrlopen:
        def __call__(self, req, timeout):  # noqa: ANN001
            seen.append(json.loads(req.data.decode())["model"])
            raise OSError("network down")

    orig = urllib.request.urlopen
    urllib.request.urlopen = FakeUrlopen()
    try:
        from fastapi.testclient import TestClient

        c = TestClient(m.app)
        r = c.post("/api/assistant", json={"message": "hello"})
    finally:
        urllib.request.urlopen = orig
    assert r.status_code == 200 and "hiccup" in r.json()["reply"], r.json()
    print("PASS  fallback chain tried:", seen, "-> graceful error reply")

    r = c.post("/api/assistant", json={})
    assert r.status_code == 400, r.status_code
    print("PASS  empty message -> 400")

    os.environ.pop("MISTRAL_API_KEY", None)
    os.environ.pop("Mistral_API_KEY", None)
    m2 = load("api_assistant_nkey")
    from fastapi.testclient import TestClient

    r2 = TestClient(m2.app).post("/api/assistant", json={"message": "hello"})
    assert r2.status_code == 200 and "warming up" in r2.json()["reply"]
    print("PASS  no-key graceful reply")

    print("ASSISTANT PROBE: ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
