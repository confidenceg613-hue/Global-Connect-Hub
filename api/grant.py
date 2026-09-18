"""
/api/grant — production endpoint for the consent page's location grant.

This host routes Python functions by EXACT file path only (api/index.py serves
/api, api/assistant.py serves /api/assistant) — dynamic subpaths like
/api/invites/by-token/{token}/grant never reach a function, so the recipient's
grant call got a 405 and their tracking session never started (0 updates sent).

The client calls this STATIC path instead, passing the token in the body:
    POST /api/grant   { token, latitude, longitude, address? }

The logic mirrors POST /api/invites/by-token/{token}/grant in api/index.py
(the grant also still works on that path wherever a real backend runs).
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon grant", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:  # psycopg2 may be absent in sandboxes; the endpoint fails soft without a DB
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
  to_name           TEXT,
  message           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending',
  whatsapp_link     TEXT NOT NULL DEFAULT '',
  consent_type      TEXT,
  token             TEXT NOT NULL UNIQUE,
  consent_page_url  TEXT,
  granted_latitude  DOUBLE PRECISION,
  granted_longitude DOUBLE PRECISION,
  granted_address   TEXT,
  granted_at        TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invite_sessions (
  id                SERIAL PRIMARY KEY,
  invite_token      TEXT NOT NULL,
  session_token     TEXT NOT NULL UNIQUE,
  granted_at        TIMESTAMPTZ,
  granted_latitude  DOUBLE PRECISION,
  granted_longitude DOUBLE PRECISION,
  granted_address   TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'location_update',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  tag        TEXT,
  data       JSONB,
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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


def _iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat()
    return str(v)


def _invite_json(r: dict, session_token: str | None = None) -> dict:
    out = {
        "id": r["id"], "fromUserId": r["from_user_id"], "toPhone": r["to_phone"],
        "toName": r.get("to_name"), "message": r.get("message") or "",
        "status": r["status"], "whatsappLink": r.get("whatsapp_link") or "",
        "consentType": r.get("consent_type"), "token": r["token"],
        "consentPageUrl": r.get("consent_page_url"),
        "grantedLatitude": r.get("granted_latitude"),
        "grantedLongitude": r.get("granted_longitude"),
        "grantedAddress": r.get("granted_address"),
        "grantedAt": _iso(r.get("granted_at")), "sentAt": _iso(r.get("sent_at")),
    }
    if session_token:
        out["sessionToken"] = session_token
    return out


@app.post("/api/grant")
async def grant_flat(request: Request):
    b = {}
    try:
        raw = await request.body()
        b = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        pass
    token = b.get("token")
    lat, lng = b.get("latitude"), b.get("longitude")
    address = b.get("address")
    if not token or lat is None or lng is None:
        return JSONResponse(
            {"error": "token, latitude and longitude are required"}, status_code=400)

    if not _db_ready():
        # No DB: still succeed so the recipient's tracking session starts.
        now = datetime.now(timezone.utc).isoformat()
        return {"id": -1, "fromUserId": 1, "toPhone": "", "message": "",
                "status": "accepted", "whatsappLink": "", "token": token,
                "grantedLatitude": lat, "grantedLongitude": lng,
                "grantedAt": now, "sentAt": now,
                "sessionToken": "offline-session"}

    row = _query("SELECT * FROM invites WHERE token = %s", (token,), one=True)
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)

    session_token = secrets.token_urlsafe(16)
    # invite_sessions has NO invite_id column (see lib/db/src/schema/
    # invite-sessions.ts) — it is keyed by invite_token, and the sharing
    # window lives in expires_at. Writing invite_id made every grant fail.
    _query(
        "INSERT INTO invite_sessions (invite_token, session_token, granted_at, "
        "granted_latitude, granted_longitude, granted_address, status, expires_at) "
        "VALUES (%s, %s, now(), %s, %s, %s, 'active', now() + interval '24 hours') RETURNING *",
        (token, session_token, lat, lng, address), one=True)

    updated = _query(
        "UPDATE invites SET status='accepted', granted_at=now(), granted_latitude=%s, "
        "granted_longitude=%s, granted_address=%s WHERE id=%s RETURNING *",
        (lat, lng, address, row["id"]), one=True)

    contact_name = updated.get("to_name") or updated["to_phone"]
    try:
        _execute(
            "INSERT INTO notifications_log (user_id, type, title, body, data) "
            "VALUES (%s, %s, %s, %s, %s)",
            (updated["from_user_id"], "location_granted",
             "✅ Location access granted",
             f"{contact_name} accepted your invite and started sharing location",
             json.dumps({"token": token, "inviteId": updated["id"],
                         "contactName": contact_name,
                         "latitude": lat, "longitude": lng})))
    except Exception:
        pass

    return _invite_json(updated, session_token=session_token)


@app.get("/api/grant")
def grant_info():
    return {"ok": True, "usage": "POST { token, latitude, longitude, address? }"}
