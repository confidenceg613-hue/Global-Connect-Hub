---
name: Telemetry privacy boundary
description: Where battery/speed/activity device telemetry is allowed to flow in PhoneLink, and where it must never go.
---

Battery level/charging state, activity type, and raw `deviceInfo` (including
`speedMps`, heading, altitude) must never be broadcast over the token-based
location SSE stream or included in any token-authenticated response. They are
only exposed through the owner-scoped `GET /api/sessions?userId=...` endpoint.

**Why:** the location SSE stream and any endpoint keyed by a share `token` is
reachable by anyone holding a contact's share link — it is not proven to be
the account owner. Device telemetry is more sensitive/identifying than a
raw lat/lng, so the codebase deliberately keeps it behind `userId`-scoped
ownership checks only. This boundary is called out in comments in
`location.ts` and `sessions.ts`.

**How to apply:** any new feature that wants to surface battery, speed,
activity, or other `deviceInfo` fields on the frontend (e.g. live-map
popups) must fetch it via a `userId`-scoped route (polling `/api/sessions`
is the established pattern) rather than adding it to the token/SSE payload,
even if that means an extra request instead of reusing data already in the
live position stream.
