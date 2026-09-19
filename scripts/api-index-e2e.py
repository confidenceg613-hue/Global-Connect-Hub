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

# ── GeoBoard media (geo-photos / geo-videos) ──────────────────────────────
import base64 as b64

png = b64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63fcffff3f030005fe02fea72d4b400000000049454e44ae426082"
)).decode()  # tiny valid 1x1 PNG
photo_data = f"data:image/jpeg;base64,{png}"

fails = []
r = c.post("/api/geo-photos", json={
    "token": tok, "photoData": photo_data, "latitude": 9.07, "longitude": 7.49,
    "address": "Asokoro, Abuja", "cameraFacing": "user",
})
print("14) geo photo upload:", r.status_code, r.json())
if r.status_code != 201: fails.append("photo upload")

r = c.post("/api/geo-videos/chunk",
           params={"uploadId": "e2eupload01", "index": 0, "token": tok},
           content=b"FAKEWEBMCHUNK0",
           headers={"Content-Type": "application/octet-stream"})
print("15) geo video chunk 0:", r.status_code, r.json())
if r.status_code != 200: fails.append("chunk 0")
r = c.post("/api/geo-videos/chunk",
           params={"uploadId": "e2eupload01", "index": 1, "token": tok},
           content=b"FAKEWEBMCHUNK1",
           headers={"Content-Type": "application/octet-stream"})
print("    geo video chunk 1:", r.status_code, r.json())
if r.status_code != 200: fails.append("chunk 1")

r = c.post("/api/geo-videos/finalize", json={
    "uploadId": "e2eupload01", "token": tok, "mimeType": "video/webm",
    "durationMs": 30000, "latitude": 9.07, "longitude": 7.49,
    "address": "Asokoro, Abuja", "cameraFacing": "environment",
})
print("16) geo video finalize:", r.status_code, r.json())
if r.status_code != 201: fails.append("finalize")

r = c.post("/api/geo-videos", json={
    "token": tok, "videoData": f"data:video/webm;base64,{b64.b64encode(b'LEGACY').decode()}",
    "mimeType": "video/webm", "durationMs": 5000,
    "latitude": 9.07, "longitude": 7.49, "cameraFacing": "user",
})
print("17) legacy geo video upload:", r.status_code, r.json())
if r.status_code != 201: fails.append("legacy video")

ph = c.get(f"/api/geo-photos/by-user/{uid}").json()
print("18) photos by-user:", len(ph), "row(s), keys ok:",
      all(k in ph[0] for k in ["photoData", "latitude", "cameraFacing", "toName", "toPhone", "inviteToken"]) if ph else "none")
if not ph or not all(k in ph[0] for k in ["photoData", "latitude", "cameraFacing", "toName", "toPhone", "inviteToken"]):
    fails.append("photos by-user shape")
vh = c.get(f"/api/geo-videos/by-user/{uid}").json()
print("19) videos by-user:", len(vh), "row(s), fields:",
      {k: vh[0].get(k) for k in ["durationMs", "cameraFacing", "mimeType"]} if vh else "none")
if len(vh) != 2: fails.append("videos by-user count")
if vh:
    # by-user is newest-first: the legacy one-shot (uploaded last) sits at [0],
    # the chunked finalize at [1] (durationMs 30000 identifies it).
    chunked = next((v for v in vh if v.get("durationMs") == 30000), None)
    if not chunked:
        print("    chunk reassembly correct: False (chunked video missing)")
        fails.append("chunked video missing")
    else:
        expect = "data:video/webm;base64," + b64.b64encode(b"FAKEWEBMCHUNK0FAKEWEBMCHUNK1").decode()
        ok_blob = chunked["videoData"] == expect
        print("    chunk reassembly correct:", ok_blob)
        if not ok_blob: fails.append("chunk reassembly")
pt = c.get(f"/api/geo-photos/by-token/{tok}").json()
print("20) photos by-token:", len(pt), "row(s)")
if len(pt) != 1: fails.append("photos by-token")
# chunks must be cleaned up after finalize
leftover = m.query("SELECT COUNT(*)::int AS n FROM geo_video_chunks WHERE upload_id = %s", ("e2eupload01",), one=True)
print("21) chunk rows after finalize:", leftover["n"])
if leftover["n"] != 0: fails.append("chunk cleanup")
# bad token rejected
rbad = c.post("/api/geo-photos", json={"token": "nope", "photoData": photo_data})
print("22) upload with unknown token rejected:", rbad.status_code)
if rbad.status_code != 404: fails.append("unknown token")

print("GEO MEDIA:", "FAIL: " + ", ".join(fails) if fails else "ALL PASS")

ov = c.get(f"/api/location-overrides/by-token/{tok}").json()
print("11) overrides:", ov)
lr = c.get(f"/api/location-reports/by-user/{uid}").json()
print("12) reports:", lr)

lu = c.get(f"/api/location-updates/{uid}").json()
print("13) location-updates (Settings export):", len(lu), "row(s),",
      {k: lu[0].get(k) for k in ["latitude", "longitude", "status"]} if lu else "none")
