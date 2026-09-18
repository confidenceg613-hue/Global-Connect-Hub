"""
E2E test for the production Python API (api/index.py) — exercises the
endpoints added for parity with the Express backend.

Run from repo root:
  DATABASE_URL="postgresql://postgres@/deepfalcon?host=/home/daytona/pgsock" \
    python3 scripts/api-index-e2e.py
"""
import importlib.util
import json
import os
import sys
import time

sys.path.insert(0, "api")
spec = importlib.util.spec_from_file_location("api_index", "api/index.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

from fastapi.testclient import TestClient  # noqa: E402

c = TestClient(m.app)

print("1) healthz:", c.get("/api/healthz").json())
# Unique phone per run so re-runs don't collide on users_full_phone_unique.
phone = "080" + str(int(time.time()))[-8:]
r = c.post("/api/users", json={
    "name": "PyE2E", "phoneNumber": phone,
    "countryCode": "+234", "countryIso": "NG",
}).json()
uid = r["id"]
print("2) user:", uid, r["name"])

r = c.post("/api/invites", json={
    "fromUserId": uid, "toName": "Py Contact", "toPhone": "+2348012345678",
    "message": "Track me please",
}).json()
tok = r["token"]
print("3) invite:", tok, r["status"])

r = c.post(f"/api/invites/by-token/{tok}/grant", json={
    "latitude": 9.07, "longitude": 7.49, "accuracy": 10,
}).json()
print("4) grant:", r.get("status"), r.get("grantedLatitude"), r.get("grantedLongitude"))
c.post("/api/location/push", json={
    "token": tok, "latitude": 9.08, "longitude": 7.50,
    "accuracy": 8, "status": "active",
})

s = c.get(f"/api/sessions?userId={uid}").json()
print("5) SESSIONS:", json.dumps({
    k: s[0].get(k) for k in
    ["toName", "latitude", "longitude", "status", "googleMapsLiveLink", "batteryLevel"]
}))

g = c.post("/api/geofences", json={
    "userId": uid, "name": "Home", "latitude": 9.05,
    "longitude": 7.45, "radiusMeters": 300,
}).json()
print("6) geofence created:", g["name"], g["radiusMeters"])
gl = c.get(f"/api/geofences/{uid}").json()
print("   list:", len(gl), "geofences")

p = c.post("/api/manual-pins", json={
    "userId": uid, "name": "Office", "latitude": 9.06, "longitude": 7.47,
}).json()
print("7) manual pin:", p["name"])
pl = c.get(f"/api/manual-pins/{uid}").json()
print("   list:", len(pl), "pins")

ma = c.get(f"/api/location/movement-analysis/{tok}").json()
print("8) movement-analysis:", ma["summary"]["totalPoints"], "points,",
      ma["summary"]["totalGaps"], "gaps")

mp = c.get(f"/api/movement-patterns?inviteId=1&userId={uid}&daysBack=30").json()
print("9) movement-patterns:", mp["summary"]["totalPoints"], "points")

gb = c.get(f"/api/guardian/brief?userId={uid}").json()
print("10) guardian brief:", len(gb["results"]), "contact(s), fields:",
      {k: gb["results"][0].get(k) for k in ["contactName", "latitude", "status"]}
      if gb["results"] else "none")

ov = c.get(f"/api/location-overrides/by-token/{tok}").json()
print("11) overrides:", ov)
lr = c.get(f"/api/location-reports/by-user/{uid}").json()
print("12) reports:", lr)

lu = c.get(f"/api/location-updates/{uid}").json()
print("13) location-updates (Settings export):", len(lu), "row(s),",
      {k: lu[0].get(k) for k in ["latitude", "longitude", "status"]} if lu else "none")
