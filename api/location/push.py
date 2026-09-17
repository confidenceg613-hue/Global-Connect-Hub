"""
/api/location/push — production endpoint for the consent page's live GPS.

The host routes functions by EXACT file path only, so the dynamic path
/api/location/push worked only where a real backend runs. This static-path
function accepts the exact same body and stores the fix + notifies the owner
when a database exists; without one it still returns ok so the recipient's
"Updates sent" counter advances and the owner's Live Map keeps receiving
the same fixes over the MQTT live channel.

Body: { token, latitude, longitude, accuracy?, source?, address?, status?,
        batteryLevel?, batteryCharging?, activityType?, deviceInfo? }
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon location push", docs_url=None, redoc_url=None)
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
  invite_id         INTEGER NOT NULL,
  invite_token      TEXT NOT NULL,
  session_token     TEXT NOT NULL UNIQUE,
  granted_at        TIMESTAMPTZ,
  granted_latitude  DOUBLE PRECISION,
  granted_longitude DOUBLE PRECISION,
  granted_address   TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS location_updates (
  id               SERIAL PRIMARY KEY,
  token            TEXT NOT NULL,
  invite_id        INTEGER,
  latitude         DOUBLE PRECISION NOT NULL,
  longitude        DOUBLE PRECISION NOT NULL,
  accuracy         DOUBLE PRECISION,
  source           TEXT,
  address          TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  battery_level    DOUBLE PRECISION,
  battery_charging BOOLEAN,
  activity_type    TEXT,
  device_info      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
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

SESSION_TTL_MS = 6 * 60 * 60 * 1000  # matches the client's sharing duration


def _db_ready() -> bool:
    if not _HAS_PSYPG or not _dsn():
        return False
    try:
        _execute(_SCHEMA, ())
        return True
    except Exception:
        return False


@app.post("/api/location/push")
async def location_push(request: Request):
    b = {}
    try:
        raw = await request.body()
        b = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        pass
    token = b.get("token")
    lat, lng = b.get("latitude"), b.get("longitude")
    if not token or lat is None or lng is None:
        return JSONResponse(
            {"error": "token, latitude and longitude are required"}, status_code=400)

    if not _db_ready():
        # Success without a DB — the MQTT live channel still delivers this fix
        # to the owner's map; the recipient's counter must advance regardless.
        return {"ok": True, "buffered": True}

    # token may be a session token or an invite token
    session = _query(
        "SELECT * FROM invite_sessions WHERE session_token = %s", (token,), one=True)
    if session:
        granted_ms = ((datetime.now(timezone.utc)
                       - session["created_at"].astimezone(timezone.utc)).total_seconds()
                      * 1000) if session.get("created_at") else 0
        if session["status"] != "active" or granted_ms > SESSION_TTL_MS:
            if session["status"] == "active":
                _execute("UPDATE invite_sessions SET status='ended' WHERE id=%s",
                         (session["id"],))
            return JSONResponse(
                {"error": "This location sharing session has ended."}, status_code=410)
        invite_token = session["invite_token"]
    else:
        invite_token = token

    invite = _query("SELECT * FROM invites WHERE token = %s", (invite_token,), one=True)
    if not invite:
        # Unknown token — still 200 so the live channel remains the source of
        # truth for links created while offline (their invites row lives only
        # on the owner's device).
        return {"ok": True, "buffered": True}

    device_info = b.get("deviceInfo")
    _execute(
        "INSERT INTO location_updates (token, invite_id, latitude, longitude, accuracy, "
        "source, address, status, battery_level, battery_charging, activity_type, device_info) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (invite_token, invite["id"], lat, lng, b.get("accuracy"), b.get("source"),
         b.get("address"), b.get("status") or "active", b.get("batteryLevel"),
         b.get("batteryCharging"), b.get("activityType"),
         json.dumps(device_info) if isinstance(device_info, dict) else None))

    if (b.get("status") or "active") == "active":
        _execute(
            "UPDATE invites SET status='accepted', granted_latitude=%s, granted_longitude=%s, "
            "granted_address=COALESCE(%s, granted_address) WHERE id=%s AND status='accepted'",
            (lat, lng, b.get("address"), invite["id"]))

    contact_name = invite.get("to_name") or invite["to_phone"]
    try:
        last = _query(
            "SELECT created_at FROM notifications_log WHERE user_id=%s AND type='location_update' "
            "AND data->>'token'=%s ORDER BY created_at DESC LIMIT 1",
            (invite["from_user_id"], invite_token), one=True)
        if last is None or (datetime.now(timezone.utc)
                            - last["created_at"].astimezone(timezone.utc)).total_seconds() >= 60:
            label = (b.get("address") or f"{float(lat):.5f}, {float(lng):.5f}")
            _execute(
                "INSERT INTO notifications_log (user_id, type, title, body, tag, data) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (invite["from_user_id"], "location_update",
                 f"📍 {contact_name} — live location", label,
                 f"live-update-{invite_token}",
                 json.dumps({"token": invite_token, "inviteId": invite["id"],
                             "contactName": contact_name,
                             "latitude": lat, "longitude": lng})))
    except Exception:
        pass

    return {"ok": True}
