"""
/api/notifications — production notification feed for the sender (owner).

The serverless host executes Python functions only at exact static paths, so
GET /api/notifications/{userId} returned the SPA's HTML in production and the
sender's bell/drawer never filled. This flat function restores the feed:

  GET /api/notifications?userId=1[&type=grant|location_update][&limit=50]
      → NotifEntry[] (same shape as the Express route)
  GET /api/notifications/unread-count?userId=1
      → { count: n }

The realtime path (bell badge + drawer entries for acceptances and moving
coordinates) still flows over the MQTT live channel; this endpoint gives the
sender a durable, refreshable list. Fail-soft: with no database it returns
an empty list rather than an error so the UI never breaks.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon notifications", docs_url=None, redoc_url=None)
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


_SCHEMA = """
CREATE TABLE IF NOT EXISTS notifications_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'location_update',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  data       JSONB,
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications_log(user_id, created_at DESC);
"""


def _db_ready() -> bool:
    if not _HAS_PSYPG or not _dsn():
        return False
    try:
        _query("SELECT 1", (), one=True)
        return True
    except Exception:
        return False


def _notif_json(r: dict) -> dict:
    return {
        "id": r["id"], "type": r.get("type") or "location_update",
        "title": r.get("title") or "", "body": r.get("body") or "",
        "data": r.get("data") if isinstance(r.get("data"), dict) else None,
        "read": bool(r.get("read")), "pinned": bool(r.get("pinned")),
        "createdAt": r["created_at"].astimezone(timezone.utc).isoformat()
        if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
    }


@app.get("/api/notifications")
def list_notifications(userId: int | None = None, type: str | None = None,
                       limit: int = 50):
    if userId is None:
        return JSONResponse({"error": "userId is required"}, status_code=400)
    if not _db_ready():
        return []  # fail soft — the live channel still carries realtime events

    rows = _query(
        "SELECT * FROM notifications_log WHERE user_id = %s "
        "ORDER BY created_at DESC LIMIT %s",
        (userId, max(1, min(limit, 200))))
    out = [_notif_json(r) for r in rows]
    if type:
        out = [n for n in out if n["type"] == type]
    return out


@app.get("/api/notifications/unread-count")
def unread_count(userId: int | None = None):
    if userId is None:
        return JSONResponse({"error": "userId is required"}, status_code=400)
    if not _db_ready():
        return {"count": 0}
    row = _query(
        "SELECT COUNT(*)::int AS n FROM notifications_log "
        "WHERE user_id = %s AND read = FALSE", (userId,), one=True)
    return {"count": (row or {"n": 0})["n"]}
