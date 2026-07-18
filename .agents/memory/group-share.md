---
name: Group Share / GMap feature
description: Architecture and decisions for the group share link system (one URL → many participants).
---

# Group Share — Architecture

## Core design (fully upgraded)
When a member joins via `POST /api/group-shares/:groupId/join`, the backend creates:
1. A `group_share_members` row with `memberToken` (identity) and `inviteToken` (location push token).
2. A real `invites` table record (`status=accepted`, `fromUserId=ownerUserId`, `toPhone=grp_<memberToken>`, `message=[group:<groupId>]`).

Members then push location to **`/api/location/push`** using their `inviteToken` — exactly like a regular invite contact. This gives them:
- Live Map visibility (owner's live-map.tsx subscribes to all accepted invite tokens)
- Geofence alerts and push notifications (via checkGeofences in location.ts)
- Full telemetry stored in `location_updates` (battery, activity, GPS extras, deviceInfo)
- Sessions dashboard visibility (synthetic invite appears in /api/sessions)
- Camera captures via captureGeoPhotos/captureGeoVideo

## DB schema
- `group_share_members.inviteToken` — nullable text column, null for legacy rows created before this column existed.
- `group_shares_group_id_idx` — unique index on groupId.

## Frontend (group-join.tsx)
Full clone of consent.tsx telemetry:
- Device fingerprint collection (async, same 17-step process)
- Battery API monitoring
- GPS extras: speedMps, headingDeg, altitudeMeters, altitudeAccuracyMeters
- Activity detection from GPS speed (stationary/walking/running/driving)
- coordsRef pattern (not stale `coords` state) in watchPosition + heartbeat callbacks
- Camera captures: rear photos → front photos → rear video → selfie video (sequential)
- Heartbeat: 3s interval using coordsRef.current — no stale closures
- Stores `{ memberToken, inviteToken }` (JSON object) in localStorage; legacy string format (just memberToken) is handled gracefully

## Frontend (gmap.tsx)
- After selecting a group, fetches `/api/group-shares/:groupId/members?userId=...`
- Subscribes to `/api/location/stream/:inviteToken` per member (NOT a single group SSE)
- SSE handler maps inviteToken → memberToken for position updates
- Telemetry polling every 15s from `/api/sessions` to enrich battery/activity
- Legacy group push endpoint (`POST /push`) kept for backward compat with old clients

## Backend (group-shares.ts)
- Group SSE endpoint removed from gmap usage (deprecated, not deleted)
- Members endpoint enriches from `location_updates` by `inviteToken` (source of truth); falls back to `lastLat/lastLng` for legacy members with null `inviteToken`

**Why:** Routing through the invite pipeline gives all features for free — no duplicate geofence, notification, or SSE code needed in group-shares.ts. Group members are indistinguishable from regular invite contacts in the pipeline.

**How to apply:** Any new feature added to the regular invite/consent flow automatically benefits group members too. No changes needed to group-shares.ts for new telemetry fields.
