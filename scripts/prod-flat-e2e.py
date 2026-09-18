"""
Production-path E2E: the flat Python endpoints the consent flow actually calls
(POST /api/user, POST /api/invite… POST /api/grant, POST /api/location/push,
GET /api/notifications), run against a database created from the DRIZZLE schema
— i.e. exactly what production has.

Run from repo root (DSN as argv[1], or set DATABASE_URL):
  python3 scripts/prod-flat-e2e.py 'postgresql://user@/deepfalcon_prod?host=/var/run/postgresql'

A fresh database has no tables, so the modules fall back to their in-memory
store and this test would report misleadingly green results. Point it at a
database built from the Drizzle schema.
"""
import importlib.util
import json
import os
import sys
import time

if len(sys.argv) > 1:
    os.environ["DATABASE_URL"] = sys.argv[1]

sys.path.insert(0, "api")
os.path.join("api", "location")  # noqa: B018 - keep path explicit

from fastapi.testclient import TestClient  # noqa: E402


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return TestClient(mod.app)


user = load("api_user", "api/user.py")
index = load("api_index", "api/index.py")
invite = load("api_invite", "api/invite.py")
grant = load("api_grant", "api/grant.py")
push = load("api_push", "api/location/push.py")
notif = load("api_notif", "api/notifications.py")

ok = fail = 0


def step(label, resp, expect=(200, 201)):
    global ok, fail
    good = resp.status_code in expect
    ok += good
    fail += not good
    body = resp.text[:160]
    print(f"  {'✅' if good else '❌'} {label:<44} {resp.status_code}  {body[:90]}")
    return resp.json() if good else None


print("═══ PRODUCTION FLAT ENDPOINTS (drizzle schema) ═══")
u = step("POST /api/user (login)", user.post("/api/user", json={
    "name": "Prod E2E", "phoneNumber": "080" + str(int(time.time()))[-8:],
    "countryCode": "+234", "countryIso": "NG",
}))
uid = (u or {}).get("id")

inv = step("POST /api/invites (create)", index.post("/api/invites", json={
    "fromUserId": uid, "toName": "Prod Contact", "toPhone": "+2348077766655",
    "message": "Track me",
}))
tok = (inv or {}).get("token")

step("GET /api/invite?token= (consent load)", invite.get(f"/api/invite?token={tok}"))

g = step("POST /api/grant (invitee accepts)", grant.post("/api/grant", json={
    "token": tok, "latitude": 9.0765, "longitude": 7.3986, "accuracy": 12,
}))
if g:
    print(f"       → status={g.get('status')} sessionToken={'yes' if g.get('sessionToken') else 'NO'}")

step("POST /api/location/push (GPS fix)", push.post("/api/location/push", json={
    "token": tok, "latitude": 9.0813, "longitude": 7.4041, "accuracy": 9,
    "status": "active", "batteryLevel": 82.4, "batteryCharging": False,
}))
step("POST /api/location/push (offline/buffered)", push.post("/api/location/push", json={
    "token": "unknown-token-xyz", "latitude": 1.0, "longitude": 2.0,
}))
step("GET /api/location/latest (owner map)", index.get(f"/api/location/latest/{tok}"))
step("GET /api/location/history (journey)", index.get(f"/api/location/history/{tok}"))
step("GET /api/sessions (Active Sessions)", index.get(f"/api/sessions?userId={uid}"))
step("POST /api/consent-sessions (timeline)", index.post("/api/consent-sessions", json={
    "inviteToken": tok, "timeToGrantMs": 4200,
    "events": [{"type": "opened", "at": "2026-01-01T00:00:00Z"}],
}))
step("GET /api/location-updates/:userId (export)", index.get(f"/api/location-updates/{uid}"))
step("GET /api/notifications (sender bell)", notif.get(f"/api/notifications?userId={uid}"))
step("GET /api/notifications/unread-count", notif.get(
    f"/api/notifications/unread-count?userId={uid}"))

print(f"\n═══ PASSED: {ok}   FAILED: {fail} ═══")
sys.exit(1 if fail else 0)
