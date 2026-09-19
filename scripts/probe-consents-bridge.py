"""Bridge-shape verification for the /api/consents routes.

Runs the real api.index ASGI app behind the same rewrite production uses
(/api/index?__path=<original-path>) and exercises the exact request shapes
the Permissions page sends through the frontend fetch bridge:

    GET  /api/index?__path=consents%3FuserId%3D1
    POST /api/index?__path=consents            (toggle ON)
    PATCH /api/index?__path=consents%2F<id>    (revoke / restore)

Usage (from repo root, with a reachable Postgres in DATABASE_URL):
    python3 scripts/probe-consents-bridge.py
"""

from __future__ import annotations

import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import psycopg2  # noqa: E402
import uvicorn  # noqa: E402

from api.index import app  # noqa: E402

HOST, PORT = "127.0.0.1", 8765


def request(method: str, url: str, payload: dict | None = None) -> tuple[int, str, str]:
    data = None
    headers = {"accept": "application/json"}
    if payload is not None:
        data = __import__("json").dumps(payload).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.headers.get("content-type", ""), resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read().decode()


def main() -> int:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        print("DATABASE_URL is not set — nothing to test")
        return 2

    server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.2)

    base = f"http://{HOST}:{PORT}"
    ok = True

    # Simulate the production bridge: params ride BESIDE __path (toEntryUrl
    # in api-bridge.ts), plus the embedded-? variant the middleware also
    # tolerates.
    B_Q = base + "/api/index?userId=1&__path=consents"
    B_EMBED = base + "/api/index?__path=" + urllib.parse.quote("consents?userId=1", safe="")

    # 1. list (empty after wipe) — params beside __path, the real bridge shape
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    conn.cursor().execute("DELETE FROM consents")
    conn.close()

    status, ctype, body = request("GET", B_Q)
    print("1. bridged GET list (params beside __path):", status, body[:80])
    ok &= status == 200 and "json" in ctype

    # 2. toggle ON (bridged POST) — exact permissions.tsx payload
    status, ctype, body = request(
        "POST",
        f"{base}/api/index?__path=consents",
        {"userId": 1, "type": "notification", "status": "granted",
         "purpose": "User explicitly granted notification permission via dashboard."},
    )
    print("2. bridged POST grant:", status, body[:120])
    ok &= status == 201
    cid = __import__("json").loads(body)["id"]

    # 3. revoke via bridged PATCH
    status, ctype, body = request(
        "PATCH", f"{base}/api/index?__path=consents%2F{cid}", {"status": "revoked"})
    print("3. bridged PATCH revoke:", status, body[:120])
    ok &= status == 200 and __import__("json").loads(body)["status"] == "revoked"

    # 4. restore via bridged PATCH
    status, ctype, body = request(
        "PATCH", f"{base}/api/index?__path=consents%2F{cid}", {"status": "granted"})
    print("4. bridged PATCH restore:", status, body[:120])
    ok &= status == 200 and __import__("json").loads(body)["status"] == "granted"

    # 5. list shows granted (params beside __path)
    status, ctype, body = request("GET", B_Q)
    print("5. bridged list raw:", status, ctype, body[:200])
    try:
        rows = __import__("json").loads(body)
    except Exception:
        rows = []
    granted = isinstance(rows, list) and any(
        isinstance(x, dict) and x.get("status") == "granted" for x in rows
    )
    print("   granted present:", granted)
    ok &= status == 200 and granted

    # 6. embedded-? tolerance — the query rides inside __path
    status, ctype, body = request("GET", B_EMBED)
    print("6. embedded-? list:", status, body[:80])
    ok &= status == 200 and "json" in ctype

    # 7. summary (direct path, no bridge) still fine
    status, ctype, body = request("GET", base + "/api/consents/summary")
    print("7. summary:", status)
    ok &= status == 200

    # cleanup
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    conn.cursor().execute("DELETE FROM consents")
    conn.close()

    print("BRIDGE SHAPE:", "ALL PASS" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
