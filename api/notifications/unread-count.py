"""
/api/notifications/unread-count — flat alias (exact-path routing).

The host routes functions by exact file path only, so the query-parameter
variant needed its own file. Returns the sender's unread notification count.

  GET /api/notifications/unread-count?userId=1   → { count: n }

Fail-soft: { count: 0 } without a database (the bell still counts realtime
live-channel events client-side).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DeepFalcon unread count", docs_url=None, redoc_url=None)
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


_SCHEMA = """
CREATE TABLE IF NOT EXISTS notifications_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


@app.get("/api/notifications/unread-count")
def unread_count(userId: int | None = None):
    if not _HAS_PSYPG or not _dsn() or userId is None:
        return {"count": 0}
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(_dsn())
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(_SCHEMA)
                cur.execute(
                    "SELECT COUNT(*)::int AS n FROM notifications_log "
                    "WHERE user_id = %s AND read = FALSE", (userId,))
                row = cur.fetchone()
                conn.commit()
        finally:
            conn.close()
        return {"count": (row or {"n": 0})["n"]}
    except Exception:
        return {"count": 0}
