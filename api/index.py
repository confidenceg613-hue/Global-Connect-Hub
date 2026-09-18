"""
DeepFalcon serverless API (Python) — backed by Postgres (Neon).

Mirrors the Express api-server contract that the generated client
(@workspace/api-client-react) and the app's raw fetch() calls expect:

  POST   /api/users
  GET    /api/users/:id
  PATCH  /api/users/:id
  GET    /api/users/by-phone/:phone
  POST   /api/invites
  GET    /api/invites?userId=
  GET    /api/invites/:id
  PATCH  /api/invites/:id
  GET    /api/invites/by-token/:token
  POST   /api/invites/by-token/:token/grant
  GET    /api/invites/by-token/:token/sessions
  POST   /api/location/push
  GET    /api/location/latest/:token
  GET    /api/location/history/:token
  GET    /api/notifications/:userId[?inviteId&type&limit]
  GET    /api/notifications/:userId/unread-count
  POST   /api/notifications/read-all
  POST   /api/notifications/read
  DELETE /api/notifications/:id?userId=
  DELETE /api/notifications/clear/:userId
  GET    /api/consents/summary
  GET    /api/sessions?userId=
  POST   /api/consent-sessions
  GET    /api/healthz

Vercel routes /api/* here via the rewrites in vercel.json.
"""

from __future__ import annotations

import json
import math
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon API", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone_number  TEXT NOT NULL,
  country_code  TEXT NOT NULL DEFAULT '',
  country_iso   TEXT NOT NULL DEFAULT '',
  full_phone    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
CREATE INDEX IF NOT EXISTS idx_invites_from ON invites(from_user_id);

CREATE TABLE IF NOT EXISTS invite_sessions (
  id                SERIAL PRIMARY KEY,
  invite_token      TEXT NOT NULL,
  session_token     TEXT NOT NULL UNIQUE,
  granted_at        TIMESTAMPTZ,
  granted_latitude  DOUBLE PRECISION,
  granted_longitude DOUBLE PRECISION,
  granted_address   TEXT,
  granted_ip        TEXT,
  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_invite ON invite_sessions(invite_token);

CREATE TABLE IF NOT EXISTS location_updates (
  id               SERIAL PRIMARY KEY,
  token            TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_loc_token ON location_updates(token, created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS consent_sessions (
  id               SERIAL PRIMARY KEY,
  invite_token     TEXT NOT NULL,
  time_to_grant_ms BIGINT,
  events           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geofences (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius_meters DOUBLE PRECISION NOT NULL DEFAULT 200,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geofences_user ON geofences(user_id);

CREATE TABLE IF NOT EXISTS manual_pins (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_pins_user ON manual_pins(user_id);

CREATE TABLE IF NOT EXISTS location_type_overrides (
  id               SERIAL PRIMARY KEY,
  invite_token     TEXT NOT NULL,
  lat_key          DOUBLE PRECISION NOT NULL,
  lng_key          DOUBLE PRECISION NOT NULL,
  override_type    TEXT NOT NULL,
  source_report_id INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_overrides_token ON location_type_overrides(invite_token);

CREATE TABLE IF NOT EXISTS location_type_reports (
  id             SERIAL PRIMARY KEY,
  invite_token   TEXT NOT NULL,
  latitude       DOUBLE PRECISION NOT NULL,
  longitude      DOUBLE PRECISION NOT NULL,
  reported_type  TEXT NOT NULL,
  suggested_type TEXT NOT NULL,
  comment        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_token ON location_type_reports(invite_token);

CREATE TABLE IF NOT EXISTS geo_photos (
  id            SERIAL PRIMARY KEY,
  invite_token  TEXT NOT NULL,
  photo_data    TEXT,
  camera_facing TEXT,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geo_photos_token ON geo_photos(invite_token);

CREATE TABLE IF NOT EXISTS geo_videos (
  id            SERIAL PRIMARY KEY,
  invite_token  TEXT NOT NULL,
  video_data    TEXT,
  duration_ms   INTEGER,
  camera_facing TEXT,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geo_videos_token ON geo_videos(invite_token);
"""

_schema_lock = threading.Lock()
_schema_ready = False


def db_connect():
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not configured")
    if "sslmode=" not in dsn:
        sep = "&" if "?" in dsn else "?"
        dsn = f"{dsn}{sep}sslmode=require"
    return psycopg2.connect(dsn)


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = db_connect()
        try:
            with conn.cursor() as cur:
                cur.execute(_SCHEMA)
                # Guest account — the app's login bypass signs everyone in as
                # userId 1 (GUEST_USER_ID). Make sure the owner row exists so
                # invites/notifications always have a valid owner.
                cur.execute("SELECT COUNT(*)::int FROM users")
                if (cur.fetchone() or (0,))[0] == 0:
                    cur.execute(
                        "INSERT INTO users (name, phone_number, country_code, country_iso) "
                        "VALUES (%s, %s, %s, %s)",
                        ("DeepFalcon Owner", "+0000000000", "", ""))
            conn.commit()
        finally:
            conn.close()
        _schema_ready = True


def query(sql: str, params: tuple = (), *, one: bool = False) -> list[dict] | dict | None:
    conn = db_connect()
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


def execute(sql: str, params: tuple = ()) -> None:
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _battery(value):
    """battery_level is INTEGER in the schema; floats abort the insert."""
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def db_ready() -> bool:
    """True when the database is reachable. Individual endpoints fail SOFT
    (same synthetic shapes the frontend's offline fallbacks expect) when it
    is not, so a missing DATABASE_URL never hard-breaks the app."""
    try:
        ensure_schema()
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Serialization helpers (snake_case rows -> camelCase API shapes)
# --------------------------------------------------------------------------- #

def user_json(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "phoneNumber": r.get("phone_number"),
        "countryCode": r.get("country_code"),
        "countryIso": r.get("country_iso"),
        "fullPhone": r.get("full_phone"),
        "createdAt": iso(r.get("created_at")),
        "updatedAt": iso(r.get("updated_at")),
    }


def invite_json(r: dict, session_token: str | None = None) -> dict:
    out = {
        "id": r["id"],
        "fromUserId": r["from_user_id"],
        "toPhone": r["to_phone"],
        "toName": r.get("to_name"),
        "message": r.get("message") or "",
        "status": r["status"],
        "whatsappLink": r.get("whatsapp_link") or "",
        "consentType": r.get("consent_type"),
        "token": r["token"],
        "consentPageUrl": r.get("consent_page_url"),
        "grantedLatitude": r.get("granted_latitude"),
        "grantedLongitude": r.get("granted_longitude"),
        "grantedAddress": r.get("granted_address"),
        "grantedAt": iso(r.get("granted_at")),
        "sentAt": iso(r.get("sent_at")),
    }
    if session_token:
        out["sessionToken"] = session_token
    return out


def invite_public_json(r: dict) -> dict:
    return {
        "token": r["token"],
        "fromUserName": r.get("from_user_name") or "",
        "status": r["status"],
        "consentType": r.get("consent_type"),
        "grantedLatitude": r.get("granted_latitude"),
        "grantedLongitude": r.get("granted_longitude"),
        "grantedAt": iso(r.get("granted_at")),
    }


def location_json(r: dict) -> dict:
    return {
        "id": r["id"],
        "token": r["token"],
        "inviteId": r.get("invite_id"),
        "latitude": r["latitude"],
        "longitude": r["longitude"],
        "accuracy": r.get("accuracy"),
        "source": r.get("source"),
        "address": r.get("address"),
        "status": r.get("status") or "active",
        "batteryLevel": r.get("battery_level"),
        "batteryCharging": r.get("battery_charging"),
        "activityType": r.get("activity_type"),
        "deviceInfo": r.get("device_info"),
        "createdAt": iso(r.get("created_at")),
    }


def notif_json(r: dict) -> dict:
    return {
        "id": r["id"],
        "userId": r["user_id"],
        "type": r["type"],
        "title": r["title"],
        "body": r["body"],
        "tag": r.get("tag"),
        "data": r.get("data"),
        "pinned": r.get("pinned", False),
        "read": r.get("read", False),
        "createdAt": iso(r.get("created_at")),
    }


def log_notification(user_id: int, ntype: str, title: str, body: str,
                     data: dict | None = None) -> None:
    execute(
        "INSERT INTO notifications_log (user_id, type, title, body, data) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, ntype, title, body,
         psycopg2.extras.Json(data) if data is not None else None),
    )


async def body_json(request: Request) -> dict:
    try:
        raw = await request.body()
        return json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        return {}


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #

@app.get("/api/healthz")
@app.get("/api/health")
def healthz():
    try:
        ensure_schema()
        query("SELECT 1", one=True)
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse({"status": "ok", "database": f"error: {e}"}, status_code=200)


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #

@app.post("/api/users")
async def create_user(request: Request):
    b = await body_json(request)
    name = (b.get("name") or "").strip()
    phone = (b.get("phoneNumber") or "").strip()
    if not name or not phone:
        return JSONResponse({"error": "name and phoneNumber are required"}, status_code=400)
    cc = (b.get("countryCode") or "").strip()
    iso_ = (b.get("countryIso") or "").strip()
    full_phone = b.get("fullPhone") or f"{cc}{phone}"
    if not db_ready():
        return {"id": 1, "name": name, "phoneNumber": phone, "countryCode": cc,
                "countryIso": iso_, "fullPhone": full_phone,
                "createdAt": datetime.now(timezone.utc).isoformat()}
    row = query(
        "INSERT INTO users (name, phone_number, country_code, country_iso, full_phone) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING *",
        (name, phone, cc, iso_, full_phone), one=True)
    return user_json(row)


@app.get("/api/users/by-phone/{phone}")
def get_user_by_phone(phone: str):
    if not db_ready():
        return JSONResponse({"error": "User not found"}, status_code=404)
    clean = phone.replace("%2B", "+").lstrip("+")
    rows = query(
        "SELECT * FROM users WHERE replace(coalesce(full_phone,''),'+','') LIKE %s "
        "   OR replace(phone_number,'+','') LIKE %s ORDER BY id LIMIT 1",
        (f"%{clean[-9:]}", f"%{clean[-9:]}"))
    if not rows:
        return JSONResponse({"error": "User not found"}, status_code=404)
    return user_json(rows[0])


@app.get("/api/users/{user_id}")
def get_user(user_id: int):
    if not db_ready():
        return JSONResponse({"error": "User not found"}, status_code=404)
    row = query("SELECT * FROM users WHERE id = %s", (user_id,), one=True)
    if not row:
        return JSONResponse({"error": "User not found"}, status_code=404)
    return user_json(row)


@app.patch("/api/users/{user_id}")
async def update_user(user_id: int, request: Request):
    if not db_ready():
        return JSONResponse({"error": "User not found"}, status_code=404)
    ensure_schema()
    b = await body_json(request)
    row = query("SELECT * FROM users WHERE id = %s", (user_id,), one=True)
    if not row:
        return JSONResponse({"error": "User not found"}, status_code=404)
    name = b.get("name", row["name"])
    phone = b.get("phoneNumber", row["phone_number"])
    cc = b.get("countryCode", row["country_code"])
    iso_ = b.get("countryIso", row["country_iso"])
    full_phone = b.get("fullPhone") or f"{cc}{phone}"
    row = query(
        "UPDATE users SET name=%s, phone_number=%s, country_code=%s, country_iso=%s, "
        "full_phone=%s, updated_at=now() WHERE id=%s RETURNING *",
        (name, phone, cc, iso_, full_phone, user_id), one=True)
    return user_json(row)


# --------------------------------------------------------------------------- #
# Invites
# --------------------------------------------------------------------------- #

def _get_invite_by_token(token: str) -> dict | None:
    return query(
        "SELECT i.*, u.name AS from_user_name FROM invites i "
        "LEFT JOIN users u ON u.id = i.from_user_id WHERE i.token = %s",
        (token,), one=True)


@app.post("/api/invites")
async def create_invite(request: Request):
    b = await body_json(request)
    from_user_id = b.get("fromUserId")
    to_phone = (b.get("toPhone") or "").strip()
    message = (b.get("message") or "").strip()
    if not from_user_id or not to_phone or not message:
        return JSONResponse(
            {"error": "fromUserId, toPhone and message are required"}, status_code=400)
    to_name = b.get("toName")
    consent_type = b.get("consentType")
    base_url = (b.get("baseUrl") or "").rstrip("/")

    token = secrets.token_urlsafe(8)
    consent_url = f"{base_url}/consent/{token}"
    sms_text = (f"{message}\n\nClick here to grant location access: {consent_url}"
                if message else f"Click here to grant location access: {consent_url}")
    whatsapp_link = f"sms:{to_phone}?body={quote(sms_text)}"

    if not db_ready():
        return {"id": -int(datetime.now(timezone.utc).timestamp() % 1_000_000_000),
                "fromUserId": from_user_id, "toPhone": to_phone, "toName": to_name,
                "message": message, "status": "pending", "whatsappLink": whatsapp_link,
                "consentType": consent_type, "token": token,
                "consentPageUrl": consent_url, "sentAt": datetime.now(timezone.utc).isoformat()}
    row = query(
        "INSERT INTO invites (from_user_id, to_phone, to_name, message, consent_type, "
        "token, consent_page_url, whatsapp_link) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
        (from_user_id, to_phone, to_name, message, consent_type, token,
         consent_url, whatsapp_link), one=True)
    return invite_json(row)


@app.get("/api/invites")
def list_invites(userId: int | None = None):
    if userId is None:
        return JSONResponse({"error": "userId is required"}, status_code=400)
    if not db_ready():
        return []
    rows = query(
        "SELECT * FROM invites WHERE from_user_id = %s ORDER BY sent_at DESC LIMIT 100",
        (userId,))
    return [invite_json(r) for r in rows]


@app.patch("/api/invites/{invite_id}")
async def update_invite(invite_id: int, request: Request):
    if not db_ready():
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    ensure_schema()
    b = await body_json(request)
    row = query("SELECT * FROM invites WHERE id = %s", (invite_id,), one=True)
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    status = b.get("status", row["status"])
    message = b.get("message", row["message"])
    to_name = b.get("toName", row["to_name"])
    row = query(
        "UPDATE invites SET status=%s, message=%s, to_name=%s WHERE id=%s RETURNING *",
        (status, message, to_name, invite_id), one=True)
    return invite_json(row)


@app.get("/api/invites/by-token/{token}")
def get_invite_by_token(token: str):
    if not db_ready():
        return {"token": token, "fromUserName": "", "status": "pending"}
    ensure_schema()
    row = _get_invite_by_token(token)
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    return invite_public_json(row)


@app.get("/api/invites/by-token/{token}/sessions")
def get_invite_sessions(token: str):
    if not db_ready():
        return []
    rows = query(
        "SELECT * FROM invite_sessions WHERE invite_token = %s ORDER BY created_at DESC",
        (token,))
    return [{
        "id": r["id"],
        "inviteToken": r["invite_token"],
        "sessionToken": r["session_token"],
        "grantedAt": iso(r.get("granted_at")),
        "grantedLatitude": r.get("granted_latitude"),
        "grantedLongitude": r.get("granted_longitude"),
        "grantedAddress": r.get("granted_address"),
        "status": r["status"],
        "createdAt": iso(r.get("created_at")),
    } for r in rows]


@app.get("/api/invites/{invite_id}")
def get_invite(invite_id: int):
    if not db_ready():
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    ensure_schema()
    row = query("SELECT * FROM invites WHERE id = %s", (invite_id,), one=True)
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)
    return invite_json(row)


@app.post("/api/invites/by-token/{token}/grant")
async def grant_consent(token: str, request: Request):
    """Recipient grants location access — accepts the invite, records the grant
    coordinates, opens a location session, and notifies the owner."""
    ensure_schema()
    b = await body_json(request)
    lat, lng = b.get("latitude"), b.get("longitude")
    address = b.get("address")
    if lat is None or lng is None:
        return JSONResponse({"error": "latitude and longitude are required"}, status_code=400)

    if not db_ready():
        return {"id": -1, "fromUserId": 1, "toPhone": "", "message": "",
                "status": "accepted", "whatsappLink": "", "token": token,
                "grantedLatitude": lat, "grantedLongitude": lng,
                "grantedAt": datetime.now(timezone.utc).isoformat(),
                "sentAt": datetime.now(timezone.utc).isoformat(),
                "sessionToken": "offline-session"}

    row = _get_invite_by_token(token)
    if not row:
        return JSONResponse({"error": "Invite not found"}, status_code=404)

    session_token = secrets.token_urlsafe(16)
    # NOTE: invite_sessions has no invite_id column (see lib/db/src/schema/
    # invite-sessions.ts) — only invite_token. expires_at is required by the
    # drizzle schema's sharing window.
    session = query(
        "INSERT INTO invite_sessions (invite_token, session_token, granted_at, "
        "granted_latitude, granted_longitude, granted_address, status, expires_at) "
        "VALUES (%s, %s, now(), %s, %s, %s, 'active', now() + interval '24 hours') RETURNING *",
        (token, session_token, lat, lng, address), one=True)

    updated = query(
        "UPDATE invites SET status='accepted', granted_at=now(), granted_latitude=%s, "
        "granted_longitude=%s, granted_address=%s WHERE id=%s RETURNING *",
        (lat, lng, address, row["id"]), one=True)

    contact_name = updated.get("to_name") or updated["to_phone"]
    log_notification(
        updated["from_user_id"], "location_granted",
        "✅ Location access granted",
        f"{contact_name} accepted your invite and started sharing location",
        data={"token": token, "inviteId": updated["id"], "contactName": contact_name,
              "latitude": lat, "longitude": lng},
    )
    return invite_json(updated, session_token=session["session_token"])


# --------------------------------------------------------------------------- #
# Location
# --------------------------------------------------------------------------- #

SESSION_TTL_MS = 6 * 60 * 60 * 1000  # matches LOCATION_SHARING_DURATION_MS client-side


@app.post("/api/location/push")
async def location_push(request: Request):
    """Contact posts their live GPS. Resolves either an invite token or a
    session token, stores the fix, mirrors it onto the invite row (which the
    owner's map polls every 20 s), and notifies the owner (throttled)."""
    ensure_schema()
    b = await body_json(request)
    token = b.get("token")
    lat, lng = b.get("latitude"), b.get("longitude")
    if not token or lat is None or lng is None:
        return JSONResponse({"error": "token, latitude and longitude are required"}, status_code=400)
    if not db_ready():
        return {"ok": False, "buffered": True}

    # token may be a session token or an invite token
    session = query("SELECT * FROM invite_sessions WHERE session_token = %s", (token,), one=True)
    if session:
        granted_ms = (datetime.now(timezone.utc) - session["created_at"].astimezone(timezone.utc)
                      ).total_seconds() * 1000 if session.get("created_at") else 0
        if session["status"] != "active" or granted_ms > SESSION_TTL_MS:
            if session["status"] == "active":
                execute("UPDATE invite_sessions SET status='ended' WHERE id=%s", (session["id"],))
            return JSONResponse({"error": "This location sharing session has ended."}, status_code=410)
        invite_token = session["invite_token"]
    else:
        invite_token = token

    invite = query("SELECT * FROM invites WHERE token = %s", (invite_token,), one=True)
    if not invite:
        return JSONResponse({"error": "Unknown token"}, status_code=404)

    device_info = b.get("deviceInfo")
    # location_updates has no invite_id column and battery_level is INTEGER in
    # the real schema — see lib/db/src/schema/location-updates.ts.
    execute(
        "INSERT INTO location_updates (token, latitude, longitude, accuracy, "
        "source, address, status, battery_level, battery_charging, activity_type, device_info) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (invite_token, lat, lng, b.get("accuracy"), b.get("source"),
         b.get("address"), b.get("status") or "active", _battery(b.get("batteryLevel")),
         b.get("batteryCharging"), b.get("activityType"),
         psycopg2.extras.Json(device_info) if isinstance(device_info, dict) else None))

    # Mirror latest fix onto the invite — the owner's live map polls this row.
    if (b.get("status") or "active") == "active":
        execute(
            "UPDATE invites SET status='accepted', granted_latitude=%s, granted_longitude=%s, "
            "granted_address=COALESCE(%s, granted_address) WHERE id=%s AND status='accepted'",
            (lat, lng, b.get("address"), invite["id"]))

    # Owner notification — throttled to one per token per minute.
    contact_name = invite.get("to_name") or invite["to_phone"]
    last = query(
        "SELECT created_at FROM notifications_log WHERE user_id=%s AND type='location_update' "
        "AND data->>'token'=%s ORDER BY created_at DESC LIMIT 1",
        (invite["from_user_id"], invite_token), one=True)
    if last is None or (datetime.now(timezone.utc) - last["created_at"].astimezone(timezone.utc)
                        ).total_seconds() >= 60:
        label = (b.get("address") or f"{float(lat):.5f}, {float(lng):.5f}")
        log_notification(
            invite["from_user_id"], "location_update",
            f"📍 {contact_name} — live location",
            label,
            data={"token": invite_token, "inviteId": invite["id"],
                  "contactName": contact_name, "latitude": lat, "longitude": lng},
        )

    return {"ok": True}


@app.get("/api/location/latest/{token}")
def location_latest(token: str):
    if not db_ready():
        return JSONResponse({"error": "No location found"}, status_code=404)
    row = query(
        "SELECT * FROM location_updates WHERE token = %s ORDER BY created_at DESC LIMIT 1",
        (token,), one=True)
    if not row:
        return JSONResponse({"error": "No location found"}, status_code=404)
    return location_json(row)


@app.get("/api/location/history/{token}")
def location_history(token: str, from_: str | None = None, to: str | None = None,
                     limit: int | None = None):
    lim = max(1, min(limit or 2000, 5000))
    if not db_ready():
        return []
    rows = query(
        "SELECT * FROM location_updates WHERE token = %s ORDER BY created_at ASC LIMIT %s",
        (token, lim))
    return [location_json(r) for r in rows]


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #

@app.get("/api/notifications/{user_id}/unread-count")
def notif_unread(user_id: int):
    if not db_ready():
        return {"count": 0}
    row = query(
        "SELECT COUNT(*)::int AS n FROM notifications_log WHERE user_id=%s AND read = FALSE",
        (user_id,), one=True)
    return {"count": row["n"] if row else 0}


@app.get("/api/notifications/{user_id}")
def notif_list(user_id: int, inviteId: int | None = None, type: str | None = None,
               limit: int | None = None):
    if not db_ready():
        return []
    rows = query(
        "SELECT * FROM notifications_log WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
        (user_id, max(1, min(limit or 50, 200))))
    out = [notif_json(r) for r in rows]
    if inviteId is not None:
        out = [n for n in out if (n["data"] or {}).get("inviteId") == inviteId]
    if type:
        out = [n for n in out if n["type"] == type]
    return out


@app.post("/api/notifications/read-all")
async def notif_read_all(request: Request):
    b = await body_json(request)
    uid = b.get("userId")
    if not uid:
        return JSONResponse({"error": "userId required"}, status_code=400)
    if not db_ready():
        return {"ok": True}
    execute("UPDATE notifications_log SET read = TRUE WHERE user_id = %s", (uid,))
    return {"ok": True}


@app.post("/api/notifications/read")
async def notif_read(request: Request):
    b = await body_json(request)
    ids = b.get("ids")
    if not ids:
        return JSONResponse({"error": "ids required"}, status_code=400)
    if not db_ready():
        return {"ok": True}
    execute("UPDATE notifications_log SET read = TRUE WHERE id = ANY(%s)", (list(ids),))
    return {"ok": True}


@app.delete("/api/notifications/{notif_id}")
def notif_delete(notif_id: int, userId: int | None = None):
    if userId is None:
        return JSONResponse({"error": "userId required"}, status_code=400)
    if not db_ready():
        return {"ok": True}
    execute("DELETE FROM notifications_log WHERE id = %s AND user_id = %s",
            (notif_id, userId))
    return {"ok": True}


@app.delete("/api/notifications/clear/{user_id}")
def notif_clear(user_id: int):
    if not db_ready():
        return {"ok": True}
    execute("DELETE FROM notifications_log WHERE user_id = %s", (user_id,))
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Consent summary + sessions
# --------------------------------------------------------------------------- #

@app.get("/api/consents/summary")
def consents_summary():
    empty = {"granted": 0, "denied": 0, "revoked": 0, "total": 0}
    if not db_ready():
        return {"location": dict(empty), "notification": dict(empty),
                "messaging": dict(empty), "totals": dict(empty)}
    ensure_schema()
    rows = query("SELECT consent_type, status, COUNT(*)::int AS n FROM invites GROUP BY 1, 2")
    summary = {"location": dict(empty), "notification": dict(empty), "messaging": dict(empty),
               "totals": dict(empty)}

    def bucket(t: str | None) -> dict:
        return summary.get(t or "totals", summary["totals"])

    for r in rows:
        b = bucket(r["consent_type"])
        if r["status"] == "accepted":
            b["granted"] += r["n"]
        elif r["status"] == "declined":
            b["denied"] += r["n"]
        b["total"] += r["n"]
    for t in ("location", "notification", "messaging"):
        summary["totals"]["granted"] += summary[t]["granted"]
        summary["totals"]["denied"] += summary[t]["denied"]
        summary["totals"]["revoked"] += summary[t]["revoked"]
        summary["totals"]["total"] += summary[t]["total"]
    return summary


@app.get("/api/sessions")
def sessions(userId: int | None = None):
    """Owner-scoped telemetry per accepted invite — powers the live-map HUD
    AND the Active Sessions page. Mirrors the Express contract exactly,
    including latitude/longitude/status/googleMapsLiveLink which the
    Sessions page renders."""
    if userId is None:
        return JSONResponse({"error": "userId is required"}, status_code=400)
    if not db_ready():
        return []
    invites = query(
        "SELECT * FROM invites WHERE from_user_id = %s AND status = 'accepted'", (userId,))
    out = []
    for inv in invites:
        latest = query(
            "SELECT * FROM location_updates WHERE token = %s ORDER BY created_at DESC LIMIT 1",
            (inv["token"],), one=True)
        consent = query(
            "SELECT * FROM consent_sessions WHERE invite_token = %s ORDER BY created_at DESC LIMIT 1",
            (inv["token"],), one=True)
        lat = latest.get("latitude") if latest else None
        lng = latest.get("longitude") if latest else None
        if lat is None:
            lat = inv.get("granted_latitude")
        if lng is None:
            lng = inv.get("granted_longitude")
        status = (latest.get("status") if latest else None) or "active"
        out.append({
            "inviteId": inv["id"],
            "token": inv["token"],
            "toName": inv.get("to_name"),
            "toPhone": inv["to_phone"],
            "fromUserId": inv["from_user_id"],
            "consentType": inv.get("consent_type"),
            "grantedAt": iso(inv.get("granted_at")),
            "consentPageUrl": inv.get("consent_page_url"),
            "latitude": lat,
            "longitude": lng,
            "address": (latest.get("address") if latest else None) or inv.get("granted_address"),
            "status": status,
            "lastUpdate": iso(latest.get("created_at")) if latest else iso(inv.get("granted_at")),
            "googleMapsLiveLink": (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
                if lat is not None and lng is not None else None
            ),
            "contactName": inv.get("to_name") or inv["to_phone"],
            "batteryLevel": latest.get("battery_level") if latest else None,
            "batteryCharging": latest.get("battery_charging") if latest else None,
            "activityType": latest.get("activity_type") if latest else None,
            "deviceInfo": latest.get("device_info") if latest else None,
            "source": latest.get("source") if latest else None,
            "accuracy": latest.get("accuracy") if latest else None,
            "consentNotifications": None,
            "consentTimeline": (consent.get("events") if consent else None),
            "aiSummary": None,
            "timeToGrantMs": (consent.get("time_to_grant_ms") if consent else None),
            "openedIp": None,
            "openedAt": iso(inv.get("sent_at")),
            "openedUserAgent": None,
            "grantedIp": None,
            "ipInfo": None,
        })
    return out


# --------------------------------------------------------------------------- #
# Access / subscription guard — fails OPEN
# --------------------------------------------------------------------------- #

_ACCESS_FAIL_OPEN = {
    "allowed": True,
    "status": "unlimited",
    "freeAccessesUsed": 0,
    "freeAccessLimit": 0,
    "freeAccessesRemaining": 0,
    "accessExpiresAt": None,
    "message": "Unlimited access",
}


def _access_table_exists() -> bool:
    try:
        row = query(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'access_status' LIMIT 1", one=True)
        return row is not None
    except Exception:
        return False


@app.get("/api/access/{user_id}/status")
def access_status(user_id: int):
    if not _access_table_exists():
        return _ACCESS_FAIL_OPEN
    try:
        row = query("SELECT * FROM access_status WHERE user_id = %s", (user_id,), one=True)
        if not row:
            return _ACCESS_FAIL_OPEN
        return row
    except Exception:
        return _ACCESS_FAIL_OPEN


@app.post("/api/access/{user_id}/redeem")
async def access_redeem(user_id: int, request: Request):
    return {"success": True, "message": "All features are unlocked — no code needed."}


@app.post("/api/access/{user_id}/check-in")
async def access_check_in(user_id: int):
    return _ACCESS_FAIL_OPEN


@app.get("/api/access/payment-info")
def access_payment_info():
    return {
        "amountNaira": 0,
        "accountNumber": "",
        "bankName": "",
        "accountName": "",
        "whatsappNumber": "",
        "instructions": "All features are unlocked.",
    }


@app.post("/api/consent-sessions")
async def consent_sessions(request: Request):
    b = await body_json(request)
    if not db_ready():
        return {"ok": False}
    token = b.get("inviteToken") or b.get("token") or ""
    events = b.get("events")
    row = query(
        "INSERT INTO consent_sessions (invite_token, time_to_grant_ms, timeline) "
        "VALUES (%s, %s, %s) RETURNING id",
        (token, b.get("timeToGrantMs"),
         psycopg2.extras.Json(events) if isinstance(events, list) else None),
        one=True)
    return {"ok": True, "id": row["id"] if row else None}


# --------------------------------------------------------------------------- #
# Geofences (Live Map — owner's saved zones)
# --------------------------------------------------------------------------- #

def _has_coords(b: dict) -> bool:
    """Shared guard for the map's lat/lng-bearing create bodies."""
    return bool(b.get("userId")) and b.get("latitude") is not None and b.get("longitude") is not None


def _geofence_json(r: dict) -> dict:
    return {
        "id": r["id"], "userId": r["user_id"], "name": r["name"],
        "latitude": r["latitude"], "longitude": r["longitude"],
        "radiusMeters": r["radius_meters"], "createdAt": iso(r.get("created_at")),
    }


@app.get("/api/geofences/{user_id}")
def geofences_list(user_id: int):
    if not db_ready():
        return []
    rows = query("SELECT * FROM geofences WHERE user_id = %s ORDER BY id", (user_id,))
    return [_geofence_json(r) for r in rows]


@app.post("/api/geofences")
async def geofences_create(request: Request):
    b = await body_json(request)
    if not _has_coords(b) or not b.get("name"):
        return JSONResponse({"error": "userId, name, latitude, longitude are required"}, status_code=400)
    if not db_ready():
        return JSONResponse({"error": "database unavailable"}, status_code=503)
    row = query(
        "INSERT INTO geofences (user_id, name, latitude, longitude, radius_meters) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING *",
        (int(b["userId"]), str(b["name"])[:80], float(b["latitude"]),
         float(b["longitude"]), float(b.get("radiusMeters") or 200)), one=True)
    return JSONResponse(_geofence_json(row), status_code=201)


@app.delete("/api/geofences/{geofence_id}")
def geofences_delete(geofence_id: int):
    if not db_ready():
        return {"ok": False}
    execute("DELETE FROM geofences WHERE id = %s", (geofence_id,))
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Manual pins (Live Map — user-dropped markers)
# --------------------------------------------------------------------------- #

def _manual_pin_json(r: dict) -> dict:
    return {
        "id": r["id"], "userId": r["user_id"], "name": r["name"],
        "latitude": r["latitude"], "longitude": r["longitude"],
        "createdAt": iso(r.get("created_at")),
    }


@app.get("/api/manual-pins/{user_id}")
def manual_pins_list(user_id: int):
    if not db_ready():
        return []
    rows = query("SELECT * FROM manual_pins WHERE user_id = %s ORDER BY id", (user_id,))
    return [_manual_pin_json(r) for r in rows]


@app.post("/api/manual-pins")
async def manual_pins_create(request: Request):
    b = await body_json(request)
    if not _has_coords(b) or not b.get("name"):
        return JSONResponse({"error": "userId, name, latitude, longitude are required"}, status_code=400)
    if not db_ready():
        return JSONResponse({"error": "database unavailable"}, status_code=503)
    row = query(
        "INSERT INTO manual_pins (user_id, name, latitude, longitude) VALUES (%s, %s, %s, %s) RETURNING *",
        (int(b["userId"]), str(b["name"])[:100], float(b["latitude"]), float(b["longitude"])), one=True)
    return JSONResponse(_manual_pin_json(row), status_code=201)


@app.delete("/api/manual-pins/{pin_id}")
def manual_pins_delete(pin_id: int):
    if not db_ready():
        return {"ok": False}
    execute("DELETE FROM manual_pins WHERE id = %s", (pin_id,))
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Location type overrides + reports (Live Map 'what is this place' layer)
# --------------------------------------------------------------------------- #

@app.get("/api/location-overrides/by-token/{token}")
def location_overrides(token: str):
    if not db_ready():
        return []
    return [{
        "id": r["id"], "inviteToken": r["invite_token"],
        "latKey": r["lat_key"], "lngKey": r["lng_key"],
        "overrideType": r["override_type"],
        "sourceReportId": r.get("source_report_id"),
        "createdAt": iso(r.get("created_at")),
    } for r in query(
        "SELECT * FROM location_type_overrides WHERE invite_token = %s ORDER BY created_at DESC",
        (token,))]


@app.get("/api/location-reports/by-user/{user_id}")
def location_reports_by_user(user_id: int):
    if not db_ready():
        return []
    return [{
        "id": r["id"], "inviteToken": r["invite_token"],
        "latitude": r["latitude"], "longitude": r["longitude"],
        "reportedType": r["reported_type"], "suggestedType": r["suggested_type"],
        "comment": r.get("comment"), "status": r["status"],
        "createdAt": iso(r.get("created_at")),
    } for r in query(
        "SELECT r.* FROM location_type_reports r "
        "JOIN invites i ON i.token = r.invite_token WHERE i.from_user_id = %s "
        "ORDER BY r.created_at DESC LIMIT 200", (user_id,))]


# --------------------------------------------------------------------------- #
# Location updates by user — powers Settings → Export Data.
# Owner-scoped via the invite join, newest first, fail-soft.
# --------------------------------------------------------------------------- #

@app.get("/api/location-updates/{user_id}")
def location_updates_by_user(user_id: int):
    if not db_ready():
        return []
    rows = query(
        "SELECT l.* FROM location_updates l "
        "JOIN invites i ON i.token = l.token WHERE i.from_user_id = %s "
        "ORDER BY l.created_at DESC LIMIT 5000", (user_id,))
    return [{
        "id": r["id"], "token": r["token"], "inviteId": r.get("invite_id"),
        "latitude": r["latitude"], "longitude": r["longitude"],
        "accuracy": r.get("accuracy"), "source": r.get("source"),
        "address": r.get("address"), "status": r["status"],
        "batteryLevel": r.get("battery_level"),
        "batteryCharging": r.get("battery_charging"),
        "activityType": r.get("activity_type"),
        "deviceInfo": r.get("device_info"),
        "createdAt": iso(r.get("created_at")),
    } for r in rows]


# --------------------------------------------------------------------------- #
# Movement patterns + movement analysis (Movement Patterns & Behavioral
# Signatures pages) — gap classification mirrored from the Express API.
# --------------------------------------------------------------------------- #

_MOVEMENT_GAP_MIN = 5  # minutes; shorter gaps are normal sampling


def _haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _classify_gap(gap_min: float, prev_status):
    if prev_status == "offline":
        if gap_min < 60:
            return "Device reported offline", "minor"
        if gap_min < 360:
            return "GPS disabled or offline mode", "moderate"
        return "Extended offline / device off", "significant"
    if gap_min < 10:
        return "Brief signal loss", "minor"
    if gap_min < 60:
        return "App backgrounded or GPS paused", "minor"
    if gap_min < 360:
        return "Probable airplane mode or location disabled", "moderate"
    if gap_min < 1440:
        return "Extended offline period — device off or in airplane mode", "significant"
    days = round(gap_min / 1440)
    return f"Tracking paused for ~{days} day{'s' if days > 1 else ''} — location services disabled", "major"


def _movement_analysis(invite_token: str, date_from, date_to):
    if not db_ready():
        return {"segments": [], "dailyCounts": {}, "summary": {
            "totalPoints": 0, "totalRealKm": 0, "totalGapKm": 0, "totalGaps": 0,
            "gapTotalMinutes": 0, "longestGapMinutes": 0, "activeDays": 0,
            "dateFrom": date_from.isoformat(), "dateTo": date_to.isoformat()}}
    points = query(
        "SELECT id, latitude, longitude, accuracy, address, status, activity_type, created_at "
        "FROM location_updates WHERE token = %s AND created_at >= %s AND created_at <= %s "
        "ORDER BY created_at ASC LIMIT 10000",
        (invite_token, date_from, date_to))
    if not points:
        return {"segments": [], "dailyCounts": {}, "summary": {
            "totalPoints": 0, "totalRealKm": 0, "totalGapKm": 0, "totalGaps": 0,
            "gapTotalMinutes": 0, "longestGapMinutes": 0, "activeDays": 0,
            "dateFrom": date_from.isoformat(), "dateTo": date_to.isoformat()}}

    segments = []
    total_real_km = 0.0
    total_gap_km = 0.0
    total_gaps = 0
    gap_total_min = 0.0
    longest_gap_min = 0.0
    run = [points[0]]

    def flush_run(run_pts):
        nonlocal total_real_km
        if not run_pts:
            return
        km = 0.0
        for j in range(1, len(run_pts)):
            km += _haversine_km(run_pts[j - 1]["latitude"], run_pts[j - 1]["longitude"],
                                run_pts[j]["latitude"], run_pts[j]["longitude"])
        total_real_km += km
        dur = (run_pts[-1]["created_at"] - run_pts[0]["created_at"]).total_seconds() / 60.0 \
            if len(run_pts) > 1 else 0.0
        segments.append({
            "type": "real", "points": [{
                "latitude": p["latitude"], "longitude": p["longitude"],
                "accuracy": p.get("accuracy"), "address": p.get("address"),
                "status": p.get("status"), "activityType": p.get("activity_type"),
                "createdAt": iso(p["created_at"]),
            } for p in run_pts],
            "distanceKm": km, "durationMinutes": round(dur),
            "startTime": run_pts[0]["created_at"].isoformat(),
            "endTime": run_pts[-1]["created_at"].isoformat(),
        })

    for i in range(1, len(points)):
        prev, curr = points[i - 1], points[i]
        gap_min = (curr["created_at"] - prev["created_at"]).total_seconds() / 60.0
        if gap_min >= _MOVEMENT_GAP_MIN:
            flush_run(run)
            run = []
            gap_km = _haversine_km(prev["latitude"], prev["longitude"], curr["latitude"], curr["longitude"])
            total_gap_km += gap_km
            total_gaps += 1
            gap_total_min += gap_min
            longest_gap_min = max(longest_gap_min, gap_min)
            reason, severity = _classify_gap(gap_min, prev.get("status"))
            steps = min(10, max(1, math.ceil(gap_km)))
            interpolated = [{
                "latitude": prev["latitude"] + (curr["latitude"] - prev["latitude"]) * k / steps,
                "longitude": prev["longitude"] + (curr["longitude"] - prev["longitude"]) * k / steps,
            } for k in range(steps + 1)]
            segments.append({
                "type": "gap",
                "fromPoint": {"latitude": prev["latitude"], "longitude": prev["longitude"],
                              "createdAt": prev["created_at"].isoformat()},
                "toPoint": {"latitude": curr["latitude"], "longitude": curr["longitude"],
                            "createdAt": curr["created_at"].isoformat()},
                "interpolated": interpolated,
                "gapMinutes": round(gap_min), "distanceKm": gap_km,
                "reason": reason, "severity": severity,
                "startTime": prev["created_at"].isoformat(),
                "endTime": curr["created_at"].isoformat(),
            })
        run.append(curr)
    flush_run(run)

    daily = {}
    for p in points:
        day = p["created_at"].date().isoformat()
        daily[day] = daily.get(day, 0) + 1

    return {
        "segments": segments,
        "dailyCounts": daily,
        "summary": {
            "totalPoints": len(points),
            "totalRealKm": round(total_real_km, 2),
            "totalGapKm": round(total_gap_km, 2),
            "totalGaps": total_gaps,
            "gapTotalMinutes": round(gap_total_min),
            "longestGapMinutes": round(longest_gap_min),
            "activeDays": len(daily),
            "dateFrom": date_from.isoformat(),
            "dateTo": date_to.isoformat(),
        },
    }


@app.get("/api/location/movement-analysis/{token}")
def movement_analysis(token: str, from_: str | None = Query(default=None, alias="from"),
                      to: str | None = None):
    now = datetime.now(timezone.utc)
    try:
        date_from = datetime.fromisoformat(from_.replace("Z", "+00:00")) if from_ else now - timedelta(days=30)
        date_to = datetime.fromisoformat(to.replace("Z", "+00:00")) if to else now
    except Exception:
        return JSONResponse({"error": "Invalid from/to date"}, status_code=400)
    return _movement_analysis(token, date_from, date_to)


@app.get("/api/movement-patterns")
def movement_patterns(inviteId: int | None = None, userId: int | None = None,
                      daysBack: int = 30):
    if not db_ready():
        return {"segments": [], "dailyCounts": {}, "summary": {}}
    token = None
    if inviteId is not None:
        row = query("SELECT token FROM invites WHERE id = %s", (inviteId,), one=True)
        token = row.get("token") if row else None
    elif userId is not None:
        row = query(
            "SELECT token FROM invites WHERE from_user_id = %s AND status = 'accepted' "
            "ORDER BY granted_at DESC LIMIT 1", (userId,), one=True)
        token = row.get("token") if row else None
    if not token:
        return {"segments": [], "dailyCounts": {}, "summary": {
            "totalPoints": 0, "totalRealKm": 0, "totalGapKm": 0, "totalGaps": 0,
            "gapTotalMinutes": 0, "longestGapMinutes": 0, "activeDays": 0,
            "dateFrom": datetime.now(timezone.utc).isoformat(),
            "dateTo": datetime.now(timezone.utc).isoformat()}}
    now = datetime.now(timezone.utc)
    return _movement_analysis(token, now - timedelta(days=max(1, min(daysBack, 365))), now)


# --------------------------------------------------------------------------- #
# Guardian brief — per-contact situation summary for the Guardian page.
# --------------------------------------------------------------------------- #

@app.get("/api/guardian/brief")
def guardian_brief(userId: int | None = None):
    if userId is None:
        return JSONResponse({"error": "Missing userId"}, status_code=400)
    if not db_ready():
        return {"results": []}
    invites = query(
        "SELECT * FROM invites WHERE from_user_id = %s AND status = 'accepted'", (userId,))
    results = []
    for inv in invites:
        latest = query(
            "SELECT * FROM location_updates WHERE token = %s ORDER BY created_at DESC LIMIT 1",
            (inv["token"],), one=True)
        photos = query(
            "SELECT camera_facing, taken_at FROM geo_photos WHERE invite_token = %s "
            "ORDER BY taken_at DESC LIMIT 4", (inv["token"],))
        videos = query(
            "SELECT camera_facing, taken_at, duration_ms FROM geo_videos WHERE invite_token = %s "
            "ORDER BY taken_at DESC LIMIT 4", (inv["token"],))
        results.append({
            "inviteId": inv["id"], "token": inv["token"],
            "contactName": inv.get("to_name") or inv["to_phone"],
            "latitude": (latest.get("latitude") if latest else None) or inv.get("granted_latitude"),
            "longitude": (latest.get("longitude") if latest else None) or inv.get("granted_longitude"),
            "status": (latest.get("status") if latest else None) or "active",
            "lastUpdate": iso(latest.get("created_at")) if latest else None,
            "batteryLevel": latest.get("battery_level") if latest else None,
            "batteryCharging": latest.get("battery_charging") if latest else None,
            "photoCount": len(photos), "videoCount": len(videos),
        })
    return {"results": results}


# Vercel serverless handler
handler = app
