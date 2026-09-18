"""
/api/invite — flat alias for the consent page's invite lookup.

The serverless host executes Python functions only at exact static paths, so
GET /api/invites/by-token/{token} never reaches a function in production and
the consent page showed "Invalid Link" before the recipient could grant —
meaning the sender never received the location-granted notification.

This static-path function restores the lookup:

    GET /api/invite?token=abc123
      → InvitePublic (same shape as /api/invites/by-token/{token})

Fail-soft: without a database it returns a minimal pending-invite shape so
the consent page still renders and the recipient can start tracking (the
grant itself already fails soft the same way in api/grant.py).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon invite lookup", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    import psycopg2  # noqa: F401
    _HAS_PSYPG = True
except Exception:  # pragma: no cover
    _HAS_PSYPG = False


def _dsn() -> str:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        return ""
    if "sslmode=" not in dsn:
        sep = "&" if "?" in dsn else "?"
        dsn = f"{dsn}{sep}sslmode=require"
    return dsn


def _query(sql: str, params: tuple, one: bool = False):
    import psycopg2
    import psycopg2.extras
    conn = psycopg2.connect(_dsn())
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
            conn.commit()
        if one:
            return dict(rows[0]) if rows else None
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/invite")
def get_invite(token: str | None = None):
    if not token:
        return JSONResponse({"error": "token is required"}, status_code=400)
    if not _HAS_PSYPG or not _dsn():
        # No DB: same minimal shape the dynamic route returns offline.
        return {"token": token, "fromUserName": "", "status": "pending"}
    try:
        row = _query(
            "SELECT i.*, u.name AS from_user_name FROM invites i "
            "LEFT JOIN users u ON u.id = i.from_user_id WHERE i.token = %s",
            (token,), one=True)
    except Exception:
        return {"token": token, "fromUserName": "", "status": "pending"}
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    from datetime import datetime, timezone

    def iso(v):
        if isinstance(v, datetime):
            return v.astimezone(timezone.utc).isoformat()
        return v

    return {
        "token": row["token"],
        "fromUserName": row.get("from_user_name") or "",
        "status": row["status"],
        "consentType": row.get("consent_type"),
        "grantedLatitude": row.get("granted_latitude"),
        "grantedLongitude": row.get("granted_longitude"),
        "grantedAt": iso(row.get("granted_at")),
    }
