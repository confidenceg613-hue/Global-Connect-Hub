"""E2E probe for the /api/consents routes in api/index.py.

Usage:
    python3 scripts/probe-consents.py

Requires a reachable Postgres in DATABASE_URL (e.g. a local dev cluster).
Run it from the repo root. The script asserts the full Permissions-page
toggle lifecycle against the real database:

    list (empty) -> POST grant -> list shows granted -> PATCH revoke
    -> PATCH restore -> GET missing = 404 -> POST invalid = 400
    -> DELETE = 204 -> filters -> summary endpoint still works

and then wipes the rows it created so runs are repeatable.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import psycopg2  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.index import app  # noqa: E402


def wipe(dsns: str) -> None:
    conn = psycopg2.connect(dsns)
    conn.autocommit = True
    conn.cursor().execute("DELETE FROM consents")
    conn.close()


def main() -> int:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        print("DATABASE_URL is not set — nothing to test")
        return 2

    client = TestClient(app)
    ok = True

    # Bootstrap the schema (creates the consents table on first run) via the
    # summary endpoint, which calls ensure_schema().
    boot = client.get("/api/consents/summary")
    print("0. bootstrap summary:", boot.status_code)
    ok &= boot.status_code == 200

    wipe(dsn)

    # 1. list (empty)
    r = client.get("/api/consents?userId=1")
    print("1. GET list (empty):", r.status_code, r.json())
    ok &= r.status_code == 200 and r.json() == []

    # 2. create consent (toggle ON) — the exact payload permissions.tsx sends
    r = client.post(
        "/api/consents",
        json={
            "userId": 1,
            "type": "location",
            "status": "granted",
            "purpose": "User explicitly granted location permission via dashboard.",
        },
    )
    print("2. POST grant:", r.status_code, r.json())
    ok &= (
        r.status_code == 201
        and r.json()["status"] == "granted"
        and r.json()["type"] == "location"
    )
    cid = r.json()["id"]

    # 3. list shows it granted
    r = client.get("/api/consents?userId=1")
    rows = r.json()
    print("3. GET list after grant:", r.status_code, [(x["type"], x["status"]) for x in rows])
    ok &= r.status_code == 200 and any(
        x["type"] == "location" and x["status"] == "granted" for x in rows
    )

    # 4. PATCH revoke (toggle OFF)
    r = client.patch(
        f"/api/consents/{cid}",
        json={"status": "revoked", "purpose": "User revoked permission via dashboard."},
    )
    print(
        "4. PATCH revoke:",
        r.status_code,
        r.json()["status"],
        "revokedAt set:",
        bool(r.json()["revokedAt"]),
    )
    ok &= bool(
        r.status_code == 200 and r.json()["status"] == "revoked" and r.json()["revokedAt"]
    )

    # 5. PATCH restore (toggle back ON)
    r = client.patch(f"/api/consents/{cid}", json={"status": "granted"})
    print(
        "5. PATCH restore:",
        r.status_code,
        r.json()["status"],
        "grantedAt set:",
        bool(r.json()["grantedAt"]),
    )
    ok &= bool(
        r.status_code == 200 and r.json()["status"] == "granted" and r.json()["grantedAt"]
    )

    # 6. 404 on missing id
    r = client.get("/api/consents/999999")
    print("6. GET missing:", r.status_code)
    ok &= r.status_code == 404

    # 7. invalid payload rejected
    r = client.post("/api/consents", json={"userId": 1, "type": "bogus", "status": "granted"})
    print("7. POST invalid type:", r.status_code)
    ok &= r.status_code == 400

    # 8. DELETE
    r = client.delete(f"/api/consents/{cid}")
    print("8. DELETE:", r.status_code)
    ok &= r.status_code == 204

    # 9. type/status filters
    client.post("/api/consents", json={"userId": 2, "type": "messaging", "status": "denied"})
    r = client.get("/api/consents?userId=2&type=messaging")
    print(
        "9. filter userId=2 type=messaging:",
        r.status_code,
        [(x["userId"], x["type"]) for x in r.json()],
    )
    ok &= r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["type"] == "messaging"

    # 10. summary endpoint unaffected
    r = client.get("/api/consents/summary")
    print("10. summary:", r.status_code, r.json()["totals"])
    ok &= r.status_code == 200

    wipe(dsn)

    print("CONSENTS E2E:", "ALL PASS" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
