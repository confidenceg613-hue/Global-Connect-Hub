---
name: Invite sessions (permanent reusable links)
description: Design decisions for the invite_sessions table and permanent reusable invite link flow
---

# Permanent invite links — session design

## The rule
Invite links never expire. Each click of the same `/consent/:token` URL creates a new independent `invite_sessions` row with a unique `sessionToken`. Previous sessions are preserved and viewable in the dashboard.

## Why
The user wants one link that works forever. Each page-load should start a fresh sharing session (new GPS stream, new selfie, new photos) without overwriting past sessions.

## Key schema
`invite_sessions` table: `id`, `inviteToken` (FK → invites.token), `sessionToken` (unique), `grantedAt`, `grantedLatitude/Longitude/Address`, `grantedIp`, `status` (active/ended), `createdAt`.

## How location storage works (critical)
**Location updates are always stored under the invite token, not the session token.**

This was the key design decision: `location_updates.token = inviteToken` (not sessionToken), even when the device sends a sessionToken. The `location/push` handler resolves sessionToken → inviteToken and stores under inviteToken.

**Why:** All existing read endpoints (`/location/latest/:token`, `/location/history/:token`, SSE stream initial payload, staleness detector) query by invite token. Storing under sessionToken would have broken all of them.

**SSE broadcast:** Broadcasts on BOTH inviteToken channel (owner's dashboard map) AND sessionToken channel (future per-session streaming).

## How to apply
- `POST /invites/by-token/:token/grant` → creates a new `invite_sessions` row, returns `sessionToken` in response body
- `consent.tsx` stores `sessionToken` in `sessionTokenRef` on grant success; uses it for subsequent location pushes and media uploads (geo-photos, geo-videos)
- `GET /invites/by-token/:token/sessions` → returns all sessions for that invite, descending by `createdAt`
- `GET /invites/by-token/:token` → response now includes `sessionCount`

## Auto-start change in consent.tsx
The auto-start effect previously had a special path for `invite.status === "accepted"` that called `startTracking` directly (skipping grant). This was removed — now every page load calls `doGrantRef.current()` unconditionally (unless stored GPS coords exist, in which case it calls `grant.mutate` directly). This ensures a new session is always created.
