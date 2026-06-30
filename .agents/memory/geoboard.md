---
name: GeoBoard feature
description: Auto photo capture on consent page, stored in geo_photos table, viewed at /geoboard
---

## What it does
When a contact opens a WhatsApp consent link and grants location access, the consent page silently requests camera permission and captures 5 JPEG frames from the rear camera (1 second apart). Each frame is uploaded to the API with GPS coordinates and address, stored permanently in the `geo_photos` table.

## DB table
`geo_photos`: id (serial PK), invite_token (text, no FK — invites.token is not unique-indexed), photo_data (text, base64 JPEG), latitude, longitude, address, taken_at

**Why no FK:** invites.token is not marked UNIQUE in the schema, so PostgreSQL won't accept it as FK target (error 42830). Constraint was removed to allow table creation.

## API routes (api-server/src/routes/geo-photos.ts)
- POST /api/geo-photos — upload one photo (body: { token, photoData, latitude, longitude, address })
- GET /api/geo-photos/by-token/:token — photos for one invite
- GET /api/geo-photos/by-user/:userId — all photos for all of a user's invites (joined with invites table)

## Frontend
- consent.tsx: captureGeoPhotos() runs after startTracking(), uses getUserMedia({ facingMode: "environment" }), draws to canvas, uploads base64 JPEG. Shows violet progress bar while capturing; "N photos saved ✓" when done. Errors swallowed silently.
- pages/geoboard.tsx: shows photos grouped by contact, tap to expand, click for Google Maps link
- Route: /geoboard (protected, added to App.tsx and NAV_ITEMS in app-layout.tsx)

## How to apply
Any changes to photo upload logic must update the SaveGeoPhotoBody Zod schema in lib/db/src/schema/geo-photos.ts and regenerate the API client if needed.
