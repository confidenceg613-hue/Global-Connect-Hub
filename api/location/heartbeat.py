"""
/api/location/heartbeat — telemetry-only ping from quiet / GPS-dark devices.

Same fail-soft philosophy as api/location/push.py: with a database it records
the heartbeat so the owner sees the device is still present; without one it
returns ok immediately (the MQTT live channel carries the realtime story).
"""

from __future__ import annotations

import json
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon heartbeat", docs_url=None, redoc_url=None)
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


def _execute(sql: str, params: tuple) -> None:
    import psycopg2
    conn = psycopg2.connect(_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS invites (
  id                SERIAL PRIMARY KEY,
  from_user_id      INTEGER NOT NULL,
  to_phone          TEXT NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending',
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invite_sessions (
  id            SERIAL PRIMARY KEY,
  invite_id     INTEGER NOT NULL,
  invite_token  TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS correlated_signals (
  id          SERIAL PRIMARY KEY,
  token       TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'heartbeat',
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _db_ready() -> bool:
    if not _HAS_PSYPG or not _dsn():
        return False
    try:
        _execute(_SCHEMA, ())
        return True
    except Exception:
        return False


@app.post("/api/location/heartbeat")
async def heartbeat(request: Request):
    b = {}
    try:
        raw = await request.body()
        b = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        pass
    token = b.get("token")
    if not token:
        return JSONResponse({"error": "token is required"}, status_code=400)

    if not _db_ready():
        return {"ok": True, "buffered": True}

    # Resolve session token → invite token when applicable
    invite_token = token
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(_dsn())
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT invite_token, status FROM invite_sessions "
                    "WHERE session_token = %s LIMIT 1", (token,))
                session = cur.fetchone()
                conn.commit()
        finally:
            conn.close()
        if session:
            if session["status"] != "active":
                return JSONResponse({"error": "Session expired"}, status_code=410)
            invite_token = session["invite_token"]
    except Exception:
        pass

    meta = {k: b.get(k) for k in
            ("activityType", "accelMagnitude", "batteryLevel", "batteryCharging",
             "networkType") if b.get(k) is not None}
    try:
        _execute(
            "INSERT INTO correlated_signals (token, source_type, latitude, longitude, "
            "accuracy, metadata) VALUES (%s, %s, %s, %s, %s, %s)",
            (invite_token, "heartbeat", b.get("latitude"), b.get("longitude"),
             b.get("accuracy"), json.dumps(meta) if meta else None))
    except Exception:
        pass

    return {"ok": True}
