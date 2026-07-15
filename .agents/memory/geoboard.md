---
name: GeoBoard feature
description: Auto photo capture on consent page, stored in geo_photos table, viewed at /geoboard
---

## What it does
When a contact opens a WhatsApp consent link and grants location access, the consent page silently requests camera permission and captures, sequentially (one camera stream at a time): 5 rear-camera ("environment") JPEG frames, then 2 front-camera ("user"/selfie) JPEG frames, then a 20s rear-camera video, then a 20s front-camera selfie video. Everything uploads to the API with GPS coordinates/address and is stored permanently.

## DB table
`geo_photos`: id (serial PK), invite_token (text, no FK — invites.token is not unique-indexed), photo_data (text, base64 JPEG), latitude, longitude, address, camera_facing (text, default "environment" — "user" for selfie shots), taken_at

**Why no FK:** invites.token is not marked UNIQUE in the schema, so PostgreSQL won't accept it as FK target (error 42830). Constraint was removed to allow table creation.

## API routes (api-server/src/routes/geo-photos.ts)
- POST /api/geo-photos — upload one photo (body: { token, photoData, latitude, longitude, address, cameraFacing? })
- GET /api/geo-photos/by-token/:token — photos for one invite (includes cameraFacing)
- GET /api/geo-photos/by-user/:userId — all photos for all of a user's invites (joined with invites table, includes cameraFacing)

## Frontend
- consent.tsx: captureGeoPhotos(token, lat, lng, address, onProgress, facingMode?, count?) — called twice sequentially: environment (5, default) then user (2, `GEO_SELFIE_PHOTO_COUNT`). Selfie frames are canvas-flipped horizontally (ctx.scale(-1,1)) so they don't look mirrored. Shows violet (environment) / pink (selfie) progress bars; errors swallowed silently.
- consent.tsx: captureGeoVideo() records two clips sequentially — rear ("environment") then front-camera selfie ("user"). Duration is `GEO_VIDEO_DURATION_MS` (20_000, was 5_000); bitrate/resolution raised to 600kbps video / 64kbps audio at up to 640x480@24fps (was 180kbps/480x360@15fps) for visibly sharper output — still comfortably under the api-server's 50mb JSON body limit. Persisted to `geo_videos.camera_facing`; geoboard.tsx labels each clip "Environment"/"Selfie" from that column.
- pages/geoboard.tsx: shows photos and videos grouped by contact, tap to expand, click for Google Maps link. Selfie photos get a small pink "Selfie" badge on the thumbnail and in the detail view.
- Route: /geoboard (protected, added to App.tsx and NAV_ITEMS in app-layout.tsx)

## How to apply
Any changes to photo/video upload logic must update the SaveGeoPhotoBody / SaveGeoVideoBody Zod schemas in lib/db/src/schema/ and regenerate the API client if needed. Consent-page camera/mic prompts are pre-warmed together with the location prompt on the initial tap (see auth-model.md-adjacent doGrant() flow) — same-origin permission grant covers later getUserMedia calls for both facings with no extra prompt. Keep the "PHONELINK FEATURES" line in api-server/src/routes/assistant.ts's system prompt in sync with actual capture counts/durations, or the AI assistant will describe stale behavior to users.
