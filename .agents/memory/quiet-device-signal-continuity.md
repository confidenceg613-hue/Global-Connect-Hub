---
name: Quiet-device signal continuity
description: Architecture and decisions for keeping position estimates alive when a device has no GPS signal.
---

# Quiet-device signal continuity

## What was built
A multi-layer position estimation pipeline that produces usable positional data even when a device's GPS is dark, intermittent, or low-power.

## Components

### Server
- **`artifacts/api-server/src/lib/position-estimator.ts`** — Pure estimation function `estimatePosition(token)` returning `BestEstimate`. Priority order: gps_live → gps_extrapolated (stationary) → dead_reckoning (moving, heading known) → ip_geo (last stored public IP via ip-api.com) → last_known.
- **`GET /api/signals/estimate/:token`** (in `signal-fusion.ts`) — Returns best estimate; resolves session token → invite token automatically.
- **`POST /api/location/heartbeat`** (in `location.ts`) — Telemetry-only push; no lat/lng required. Resolves requesting IP → coordinates via ip-api.com, stores as `correlated_signals` with sourceType `network_info`. Returns the current estimate.

### Client — consent page (`artifacts/app/src/pages/consent.tsx`)
- `lastDarkHeartbeatRef` tracks last dark-GPS heartbeat timestamp.
- When GPS error fires (not PERMISSION_DENIED), immediately sends a heartbeat.
- The 3s heartbeat interval checks if GPS has been silent >45s and, if so, sends a `/api/location/heartbeat` ping throttled to once per 60s.

### Client — use-fused-location.ts (`artifacts/app/src/hooks/use-fused-location.ts`)
- Added `"ip_geo"` to `LocationSource` union.
- Added `ipGeoFallback?: () => Promise<...>` option — called after 8s when GPS fails with no cached fix.

### Client — live map (`artifacts/app/src/pages/live-map.tsx`)
- `bestEstimateByToken` ref (Map<token, BestEstimate>).
- Polling effect fetches `/api/signals/estimate/:token` every 30s for stale contacts.
- Rendering: dead_reckoning estimates project the marker to estimated position; a dashed ring shows uncertainty (amber = dead reckoning, violet = IP geo, slate = extrapolated/last known).

## Key decisions

**Why `correlated_signals` (not `location_updates`) for heartbeat positions:**
`location_updates.latitude` is NOT NULL, so IP-geo-only points can't go there. `correlated_signals` supports nullable lat/lng and already has a sourceType taxonomy for residual signals.

**Dead reckoning capped at 90 min:** Beyond that, the uncertainty radius typically exceeds useful city-scale resolution.

**IP geo accuracy hardcoded at 5 000 m:** ip-api.com city-level accuracy is ~5–50km; 5 000m is the conservative/optimistic end that gives a visible but honest ring on the map.

**Heartbeat throttled to 60s:** Aggressive enough to keep IP geo fresh across ISP DHCP changes, conservative enough not to flood ip-api.com's free tier.
