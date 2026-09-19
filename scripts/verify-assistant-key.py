"""
Verify api/assistant.py end to end with a real Mistral key.

Usage:
    python3 scripts/verify-assistant-key.py <MISTRAL_API_KEY>

Runs the production module's ASGI app in-process and asserts that:
  1. With the key set, POST /api/assistant returns a genuine AI reply
     (not the "warming up" no-key message and not the hiccup fallback).
  2. A map command request (e.g. "take me to Lagos") parses into a
     {reply, command} contract the widget can execute.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402
from api.assistant import app  # noqa: E402

NO_KEY_MARKER = "not configured"
HICCUP_MARKER = "hiccup"


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("usage: verify-assistant-key.py <MISTRAL_API_KEY>")
        return 2
    os.environ["MISTRAL_API_KEY"] = sys.argv[1].strip().splitlines()[0].strip()

    client = TestClient(app)
    failures = []

    # 1. Plain chat — must reach Mistral and answer.
    r = client.post("/api/assistant", json={"message": "Say hello in one short sentence."})
    body = r.json()
    reply = str(body.get("reply", ""))
    if r.status_code != 200:
        failures.append(f"chat: HTTP {r.status_code}: {body}")
    elif not reply or NO_KEY_MARKER in reply or HICCUP_MARKER in reply:
        failures.append(f"chat: no real AI reply: {reply[:120]!r}")
    else:
        print(f"PASS  chat reply: {reply[:80]!r}")

    # 2. Command extraction — a place request should produce a usable command.
    r2 = client.post("/api/assistant", json={"message": "Fly the map to Paris, France."})
    body2 = r2.json()
    cmd = body2.get("command")
    if r2.status_code != 200 or not body2.get("reply"):
        failures.append(f"command: HTTP {r2.status_code}: {body2}")
    elif not (isinstance(cmd, dict) and cmd.get("type")):
        failures.append(f"command: no command object parsed (reply={str(body2.get('reply'))[:80]!r})")
    else:
        print(f"PASS  command parsed: {json.dumps(cmd)[:100]}")

    # 3. Vision — a tiny image should be analyzed by pixtral, not rejected.
    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    )
    r3 = client.post("/api/assistant", json={
        "message": "Describe this image in one short sentence.", "image": tiny_png,
    })
    body3 = r3.json()
    reply3 = str(body3.get("reply", ""))
    if r3.status_code != 200:
        failures.append(f"vision: HTTP {r3.status_code}: {body3}")
    elif not reply3 or HICCUP_MARKER in reply3:
        failures.append(f"vision: analysis failed: {reply3[:120]!r}")
    else:
        print(f"PASS  vision reply: {reply3[:80]!r}")

    if failures:
        for f in failures:
            print(f"FAIL  {f}")
        return 1
    print("ASSISTANT KEY VERIFICATION: ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
