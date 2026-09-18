"""Diagnose why the grant notification insert is swallowed.

Run: python3 scripts/probe-notify.py <dsn>
"""
import importlib.util
import json
import os
import sys

os.environ["DATABASE_URL"] = sys.argv[1] if len(sys.argv) > 1 else ""


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


grant = load("api_grant", "api/grant.py")
notif = load("api_notif", "api/notifications.py")

row = grant._query("SELECT * FROM invites ORDER BY id DESC LIMIT 1", (), one=True)
print("latest invite id:", row.get("id"), "| from_user_id:", row.get("from_user_id"))
try:
    grant._execute(
        "INSERT INTO notifications_log (user_id, type, title, body, data) "
        "VALUES (%s, %s, %s, %s, %s)",
        (row["from_user_id"], "location_granted", "probe", "probe body",
         json.dumps({"probe": True})))
    print("insert via grant._execute:  OK")
except Exception as e:  # noqa: BLE001
    print("insert via grant._execute:  FAILED ->", type(e).__name__, str(e)[:200])

rows = grant._query("SELECT * FROM notifications_log", ())
print("notifications_log rows:", len(rows))
print("notif app list ->", notif.app and notif.list_notifications(userId=row["from_user_id"]))
