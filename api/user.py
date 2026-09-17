"""
/api/user — production login/registration endpoint.

The serverless host executes Python functions only at exact static paths, so
the landing page's POST /api/users (dynamic, sub-path of the full API) had no
function in production. This flat alias restores the login flow:

    POST /api/user
      { name, phoneNumber, countryCode, countryIso }

Returns the existing account when the phone is already registered (login),
otherwise creates the account — matching the Express contract, including the
`isExistingUser` flag the landing page uses for its welcome message.

Fail-soft: without a database it synthesizes a stable per-phone user id so
sign-in still works (identity is derived from the phone number).
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="DeepFalcon user", docs_url=None, redoc_url=None)
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
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone_number  TEXT NOT NULL,
  country_code  TEXT NOT NULL DEFAULT '',
  country_iso   TEXT NOT NULL DEFAULT '',
  full_phone    TEXT UNIQUE,
  google_id     TEXT,
  google_email  TEXT,
  google_name   TEXT,
  google_picture TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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


def _user_json(r: dict, existing: bool | None = None) -> dict:
    out = {
        "id": r["id"], "name": r["name"],
        "phoneNumber": r.get("phone_number"),
        "countryCode": r.get("country_code"),
        "countryIso": r.get("country_iso"),
        "fullPhone": r.get("full_phone"),
        "googleId": r.get("google_id"),
        "googleEmail": r.get("google_email"),
        "googleName": r.get("google_name"),
        "googlePicture": r.get("google_picture"),
        "createdAt": r["created_at"].astimezone(timezone.utc).isoformat()
        if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
    }
    if existing is not None:
        out["isExistingUser"] = existing
    return out


def _offline_id(full_phone: str) -> int:
    """Stable per-phone id without a database (deterministic, positive)."""
    digest = hashlib.sha1(full_phone.encode("utf-8")).hexdigest()
    return 1_000_000 + int(digest[:6], 16)


@app.get("/api/user")
def user_info():
    return {"ok": True, "usage": "POST { name, phoneNumber, countryCode, countryIso }"}


@app.post("/api/user")
async def create_or_login(request: Request):
    b = {}
    try:
        raw = await request.body()
        b = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        pass

    name = (b.get("name") or "").strip()
    phone = (b.get("phoneNumber") or "").strip()
    country_code = (b.get("countryCode") or "").strip()
    country_iso = (b.get("countryIso") or "").strip()
    if not name or not phone:
        return JSONResponse({"error": "name and phoneNumber are required"}, status_code=400)

    full_phone = f"{country_code}{phone}".replace(" ", "")

    if not _db_ready():
        # No DB: derive a stable identity from the phone so sign-in works.
        uid = _offline_id(full_phone)
        now = datetime.now(timezone.utc).isoformat()
        return {"id": uid, "name": name, "phoneNumber": phone,
                "countryCode": country_code, "countryIso": country_iso,
                "fullPhone": full_phone, "createdAt": now,
                "isExistingUser": False}

    existing = _query("SELECT * FROM users WHERE full_phone = %s", (full_phone,), one=True)
    if existing:
        return _user_json(existing, existing=True)

    row = _query(
        "INSERT INTO users (name, phone_number, country_code, country_iso, full_phone) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING *",
        (name, phone, country_code, country_iso, full_phone), one=True)
    return _user_json(row, existing=False)
