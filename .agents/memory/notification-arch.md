---
name: Notification architecture
description: How push notifications + notification log are wired together in PhoneLink
---

## Rule
All push notification sending MUST go through `artifacts/api-server/src/lib/notifications.ts → sendPushAndLog()`. Never call `webpush.sendNotification()` directly from a route.

**Why:** `sendPushAndLog` atomically: (1) inserts a row into `notifications_log` for in-app history, (2) dispatches web-push to all subscriptions for the user, (3) auto-cleans expired (410/404) subscriptions.

**How to apply:**
- Any new route that needs to send a push imports `{ sendPushAndLog }` from `../lib/notifications.js` (note `.js` extension for esbuild).
- The payload requires a `type` field matching the `notifications_log` enum: `geofence_enter | geofence_exit | location_offline | location_online | location_stale | sos | grant`.
- The frontend polls `/api/notifications/:userId/unread-count` every 30s for the badge; mark-read is POST `/api/notifications/read-all`.
- Staleness detector runs as a `setInterval` started in `artifacts/api-server/src/index.ts` via `startStalenessDetector()` from `routes/location.ts`.
