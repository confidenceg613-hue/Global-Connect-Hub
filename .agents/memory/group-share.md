---
name: Group Share / GMap feature
description: Group Share lets one link serve multiple participants; locations go to GMap only, never the main live-map.
---

## Architecture

**DB tables (lib/db/src/schema/group-shares.ts):**
- `group_shares` — one row per group: `groupId` (12-char URL-safe token), `ownerUserId`, `name`
- `group_share_members` — one row per participant: `memberToken` (unique per-member), `groupShareId`, `displayName`, `lastLat/Lng/Address/Seen`

**Backend (artifacts/api-server/src/routes/group-shares.ts):**
- `POST /api/group-shares` — owner creates group
- `GET /api/group-shares?userId=` — list owner's groups
- `GET /api/group-shares/:groupId/info` — public (used by join page)
- `POST /api/group-shares/:groupId/join` — returns per-member `memberToken`
- `POST /api/group-shares/:groupId/push` — member pushes location (validated by memberToken)
- `GET /api/group-shares/:groupId/stream?userId=` — SSE stream for owner (GMap)
- `GET /api/group-shares/:groupId/members?userId=` — list members
- `DELETE /api/group-shares/:groupId` — owner deletes group
- In-memory `groupSseClients: Map<groupId, Set<Response>>` — separate from standard `sseClients` in location.ts

**Why isolated from live-map:**
Group member tokens are NOT in the `invites` table, so `/api/sessions` and live-map's `useListInvites` never see them. Locations push to a dedicated endpoint and broadcast on a separate SSE channel.

**Frontend:**
- `/group/:groupId` — public join page (group-join.tsx), no auth required, animated dark indigo theme
- `/gmap` — protected GMap page (gmap.tsx), Leaflet map + group sidebar, owner-only SSE subscription
- Nav: "GROUP SHARE" section → GMap
